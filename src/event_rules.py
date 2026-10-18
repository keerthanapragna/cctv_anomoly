import time
from enum import Enum
from collections import deque
from typing import Dict, List, Tuple, Optional
import numpy as np

from src.detector import box_center, PersonDetection, DogDetection
import src.config as cfg


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class PersonState(Enum):
    UPRIGHT = "UPRIGHT"
    DESCENT_DETECTED = "DESCENT_DETECTED"
    ON_GROUND = "ON_GROUND"
    ALERTED = "ALERTED"


class DogInteractionState(Enum):
    CLEAR = "CLEAR"                    # Dog and person not near each other
    PROXIMITY = "PROXIMITY"            # Dog within proximity radius; monitoring
    INTERACTION = "INTERACTION"        # Overlapping boxes + person movement burst
    ALERTED = "ALERTED"               # POSSIBLE_DOG_ATTACK alert dispatched


class InterPersonState(Enum):
    CLEAR = "CLEAR"                    # Separated or calm
    PROXIMITY = "PROXIMITY"            # Interpersonal proximity watch
    SUSPICIOUS = "SUSPICIOUS"          # Elevated cues, below alert threshold (visual flag)
    ALERTED = "ALERTED"               # Sustained physical altercation -> alert dispatched



def calculate_torso_angle(
    keypoints: Optional[np.ndarray],
    confs: Optional[np.ndarray],
    conf_thresh: float = cfg.KEYPOINT_CONF_THRESHOLD,
) -> Optional[float]:
    """
    Computes angle (in degrees, 0 to 90) of torso vector relative to horizontal plane.
    0° = horizontal (lying down), 90° = vertical (standing upright).
    COCO Keypoints: 5=Left Shoulder, 6=Right Shoulder, 11=Left Hip, 12=Right Hip.
    """
    if keypoints is None or len(keypoints) < 13:
        return None

    if confs is not None:
        shoulder_ok = (confs[5] >= conf_thresh) or (confs[6] >= conf_thresh)
        hip_ok = (confs[11] >= conf_thresh) or (confs[12] >= conf_thresh)
        if not (shoulder_ok and hip_ok):
            return None

    s_left, s_right = keypoints[5], keypoints[6]
    h_left, h_right = keypoints[11], keypoints[12]

    mid_shoulder = (s_left + s_right) / 2.0
    mid_hip = (h_left + h_right) / 2.0

    dx = abs(mid_shoulder[0] - mid_hip[0])
    dy = abs(mid_shoulder[1] - mid_hip[1])

    if dx + dy < 1e-4:
        return None

    angle = np.degrees(np.arctan2(dy, dx))
    return float(angle)


def _box_center_overlap(person_bbox: np.ndarray, dog_bbox: np.ndarray) -> float:
    """
    Computes the fraction of the SMALLER box (dog) that intersects the LARGER box (person).
    A high value (> DOG_OVERLAP_THRESH) indicates very close contact rather than mere proximity.
    """
    xA = max(person_bbox[0], dog_bbox[0])
    yA = max(person_bbox[1], dog_bbox[1])
    xB = min(person_bbox[2], dog_bbox[2])
    yB = min(person_bbox[3], dog_bbox[3])

    inter_w = max(0.0, xB - xA)
    inter_h = max(0.0, yB - yA)
    inter_area = inter_w * inter_h

    dog_area = max(1.0, (dog_bbox[2] - dog_bbox[0]) * (dog_bbox[3] - dog_bbox[1]))
    return inter_area / dog_area


def _proximity(person_bbox: np.ndarray, dog_bbox: np.ndarray) -> Tuple[float, float]:
    """
    Returns (centre_distance, reference_scale) where scale is the larger of
    person height and dog height.
    """
    px, py = box_center(person_bbox)
    dx, dy = box_center(dog_bbox)
    distance = float(np.hypot(px - dx, py - dy))
    person_h = max(1.0, float(person_bbox[3] - person_bbox[1]))
    dog_h = max(1.0, float(dog_bbox[3] - dog_bbox[1]))
    scale = max(person_h, dog_h)
    return distance, scale


def _is_near(person_bbox: np.ndarray, dog_bbox: np.ndarray) -> bool:
    dist, scale = _proximity(person_bbox, dog_bbox)
    return dist < cfg.DOG_PROXIMITY_RATIO * scale


# ---------------------------------------------------------------------------
# Per-pair Dog Interaction State Machine
# ---------------------------------------------------------------------------

class PairInteractionState:
    """
    Tracks the interaction history between ONE person track and ONE dog track
    over time.  Escalates through CLEAR → PROXIMITY → INTERACTION → ALERTED.
    """

    def __init__(self, person_id: int, dog_id: int):
        self.person_id = person_id
        self.dog_id = dog_id
        self.state = DogInteractionState.CLEAR
        self.last_seen: float = time.time()

        # Timestamps for state transitions
        self.proximity_start: Optional[float] = None
        self.interaction_start: Optional[float] = None
        self.last_alert_time: float = 0.0

        # Rolling window of person center-y samples (for movement burst calc)
        self._person_centers: deque = deque(maxlen=15)

    def update(
        self,
        person: PersonDetection,
        dog: DogDetection,
        now: float,
    ) -> List[Tuple[str, str]]:
        """
        Evaluates one paired observation.  Returns list of (event_type, detail) events.
        """
        self.last_seen = now
        events: List[Tuple[str, str]] = []

        px, py = box_center(person.bbox)
        self._person_centers.append((now, px, py))

        # Compute spatial features
        dist, scale = _proximity(person.bbox, dog.bbox)
        near = dist < cfg.DOG_PROXIMITY_RATIO * scale
        overlap_frac = _box_center_overlap(person.bbox, dog.bbox)
        in_contact = overlap_frac >= cfg.DOG_OVERLAP_THRESH or (near and overlap_frac > 0.02)

        # Compute person movement rate while the dog is near
        burst = self._person_movement_rate(now)

        # ---- State Machine ----
        if self.state == DogInteractionState.CLEAR:
            if near:
                self.proximity_start = now
                self.state = DogInteractionState.PROXIMITY

        elif self.state == DogInteractionState.PROXIMITY:
            if not near:
                # Dog moved away before interaction qualified
                self.state = DogInteractionState.CLEAR
                self.proximity_start = None
            else:
                elapsed_proximity = now - (self.proximity_start or now)
                # Escalate to INTERACTION only after minimum sustained proximity time
                if (
                    elapsed_proximity >= cfg.DOG_MIN_PROXIMITY_TIME
                    and in_contact
                    and burst >= cfg.DOG_PERSON_MOVEMENT_BURST
                ):
                    self.interaction_start = now
                    self.state = DogInteractionState.INTERACTION

        elif self.state == DogInteractionState.INTERACTION:
            if not near:
                # Dog left; reset fully
                self.state = DogInteractionState.CLEAR
                self.proximity_start = None
                self.interaction_start = None
            elif not in_contact:
                # Remained nearby but overlap cue dropped; fall back to proximity watch
                self.state = DogInteractionState.PROXIMITY
                self.interaction_start = None
            else:
                elapsed_interaction = now - (self.interaction_start or now)
                if elapsed_interaction >= cfg.DOG_MIN_INTERACTION_TIME:
                    # All cues sustained long enough → alert
                    if now - self.last_alert_time >= cfg.DOG_PAIR_ALERT_COOLDOWN:
                        detail = self._build_detail(dist, scale, overlap_frac, burst, elapsed_interaction)
                        events.append(("POSSIBLE_DOG_ATTACK", detail))
                        self.last_alert_time = now
                    self.state = DogInteractionState.ALERTED

        elif self.state == DogInteractionState.ALERTED:
            if not near:
                # Dog left the scene; reset
                self.state = DogInteractionState.CLEAR
                self.proximity_start = None
                self.interaction_start = None

        return events

    def _person_movement_rate(self, now: float) -> float:
        """
        Returns estimated person-centre movement speed (pixels/sec) measured as
        cumulative path length over recent history.  Using path length (not net
        displacement) correctly captures oscillatory / jostling motion that is
        characteristic of a physical struggle, while a person standing still or
        walking smoothly will produce low values.
        """
        centers = list(self._person_centers)
        if len(centers) < 2:
            return 0.0
        total_dist = 0.0
        for i in range(1, len(centers)):
            total_dist += float(np.hypot(
                centers[i][1] - centers[i - 1][1],
                centers[i][2] - centers[i - 1][2],
            ))
        total_dt = centers[-1][0] - centers[0][0]
        if total_dt < 1e-4:
            return 0.0
        return total_dist / total_dt

    def _build_detail(
        self,
        dist: float,
        scale: float,
        overlap_frac: float,
        burst: float,
        elapsed: float,
    ) -> str:
        return (
            f"Person #{self.person_id} / Dog #{self.dog_id}: "
            f"close overlap ({overlap_frac * 100:.1f}% of dog box) for {elapsed:.1f}s, "
            f"person movement {burst:.1f}px/s. "
            f"Distance {dist:.1f}px (scale={scale:.0f}px). "
            f"Human verification required. Not a confirmed attack."
        )


# ---------------------------------------------------------------------------
# Person-to-Person Altercation Detection (Temporal Sequence Baseline)
# ---------------------------------------------------------------------------

class PersonPairInteractionState:
    """
    Evaluates short temporal sequences (1.5 - 3.0s) of interaction between TWO tracked people.
    Calculates altercation confidence while filtering false positives from:
      1. Sports / Running (unidirectional high-speed path linearity)
      2. Friendly gestures / Hugging (low kinetic motion during close contact)
      3. Dancing (smooth, rhythmic cadence with low impact jerk)
      4. Crowds (scene density dampener)
    Dispatches POSSIBLE_ALTERCATION with human-verification requirement when confidence >= threshold.
    """

    def __init__(self, person_a_id: int, person_b_id: int):
        self.person_a_id = min(person_a_id, person_b_id)
        self.person_b_id = max(person_a_id, person_b_id)
        self.state = InterPersonState.CLEAR
        self.last_seen: float = time.time()
        self.conflict_start_time: Optional[float] = None
        self.last_alert_time: float = 0.0
        self.confidence: float = 0.0
        self.last_metrics: Dict[str, float] = {}

        # Rolling sequence history: (t, box_a, box_b, c_a, c_b, kpts_a, kpts_b, conf_a, conf_b)
        self.history: deque = deque(maxlen=45)

    def update(
        self,
        person_a: PersonDetection,
        person_b: PersonDetection,
        scene_people_count: int,
        now: float,
    ) -> List[Tuple[str, str]]:
        self.last_seen = now
        events: List[Tuple[str, str]] = []

        # Canonical ordering
        p1, p2 = (person_a, person_b) if person_a.track_id < person_b.track_id else (person_b, person_a)
        b1, b2 = p1.bbox, p2.bbox
        c1, c2 = box_center(b1), box_center(b2)

        self.history.append((now, b1, b2, c1, c2, p1.keypoints, p2.keypoints, p1.keypoint_conf, p2.keypoint_conf))

        # Prune snapshots older than sequence window
        while self.history and (now - self.history[0][0]) > cfg.FIGHT_SEQUENCE_WINDOW_SEC:
            self.history.popleft()

        # Spatial check
        dist = float(np.hypot(c1[0] - c2[0], c1[1] - c2[1]))
        h1 = max(1.0, float(b1[3] - b1[1]))
        h2 = max(1.0, float(b2[3] - b2[1]))
        scale = max(h1, h2)
        is_near = dist < cfg.FIGHT_PROXIMITY_RATIO * scale

        if len(self.history) < 4:
            if is_near and self.state == InterPersonState.CLEAR:
                self.state = InterPersonState.PROXIMITY
            return events

        # Analyze short video sequence
        v1_list, v2_list = [], []
        speed1_list, speed2_list = [], []
        dist_list, overlap_list = [], []

        for i in range(1, len(self.history)):
            dt = max(1e-4, self.history[i][0] - self.history[i - 1][0])
            ca_prev, ca_curr = self.history[i - 1][3], self.history[i][3]
            cb_prev, cb_curr = self.history[i - 1][4], self.history[i][4]

            vx1 = (ca_curr[0] - ca_prev[0]) / dt
            vy1 = (ca_curr[1] - ca_prev[1]) / dt
            vx2 = (cb_curr[0] - cb_prev[0]) / dt
            vy2 = (cb_curr[1] - cb_prev[1]) / dt

            v1_list.append((vx1, vy1))
            v2_list.append((vx2, vy2))
            speed1_list.append(float(np.hypot(vx1, vy1)))
            speed2_list.append(float(np.hypot(vx2, vy2)))

            d = float(np.hypot(ca_curr[0] - cb_curr[0], ca_curr[1] - cb_curr[1]))
            dist_list.append(d)

            # Box overlap fraction
            box1, box2 = self.history[i][1], self.history[i][2]
            xA = max(box1[0], box2[0])
            yA = max(box1[1], box2[1])
            xB = min(box1[2], box2[2])
            yB = min(box1[3], box2[3])
            inter_area = max(0.0, xB - xA) * max(0.0, yB - yA)
            min_area = min(
                max(1.0, (box1[2] - box1[0]) * (box1[3] - box1[1])),
                max(1.0, (box2[2] - box2[0]) * (box2[3] - box2[1])),
            )
            overlap_list.append(inter_area / min_area)

        # Acceleration and Jerk across sequence
        a1_mags, a2_mags = [], []
        for i in range(1, len(v1_list)):
            dt = max(1e-4, self.history[i + 1][0] - self.history[i][0])
            ax1 = (v1_list[i][0] - v1_list[i - 1][0]) / dt
            ay1 = (v1_list[i][1] - v1_list[i - 1][1]) / dt
            ax2 = (v2_list[i][0] - v2_list[i - 1][0]) / dt
            ay2 = (v2_list[i][1] - v2_list[i - 1][1]) / dt
            a1_mags.append(float(np.hypot(ax1, ay1)))
            a2_mags.append(float(np.hypot(ax2, ay2)))

        mean_accel = float((np.mean(a1_mags) + np.mean(a2_mags)) / 2.0) if a1_mags else 0.0
        std_speed = float((np.std(speed1_list) + np.std(speed2_list)) / 2.0) if speed1_list else 0.0
        mean_speed = float((np.mean(speed1_list) + np.mean(speed2_list)) / 2.0) if speed1_list else 0.0
        mean_dist = float(np.mean(dist_list)) if dist_list else dist
        mean_overlap = float(np.mean(overlap_list)) if overlap_list else 0.0

        # 1. Proximity score
        if mean_dist < cfg.FIGHT_PROXIMITY_RATIO * scale:
            s_prox = max(0.0, 1.0 - (mean_dist / (cfg.FIGHT_PROXIMITY_RATIO * scale)))
        else:
            s_prox = 0.0

        # 2. Overlap / Grappling score
        if mean_overlap >= cfg.FIGHT_OVERLAP_THRESH:
            s_grapple = min(1.0, mean_overlap / 0.25)
        else:
            s_grapple = 0.0

        # 3. Erratic motion / Jerk score
        s_jerk = min(1.0, max(0.0, (mean_accel / 500.0) * 0.65 + (std_speed / 120.0) * 0.35))

        # 4. Limb dynamics score (inspect confident wrist movements relative to body)
        s_limbs = 0.0
        kpts1, kpts2 = self.history[-1][5], self.history[-1][6]
        conf1, conf2 = self.history[-1][7], self.history[-1][8]
        if (
            kpts1 is not None
            and kpts2 is not None
            and conf1 is not None
            and conf2 is not None
            and len(kpts1) >= 11
            and len(kpts2) >= 11
        ):
            w_conf_1 = (conf1[9] >= cfg.KEYPOINT_CONF_THRESHOLD or conf1[10] >= cfg.KEYPOINT_CONF_THRESHOLD)
            w_conf_2 = (conf2[9] >= cfg.KEYPOINT_CONF_THRESHOLD or conf2[10] >= cfg.KEYPOINT_CONF_THRESHOLD)
            if w_conf_1 and w_conf_2:
                s_limbs = min(1.0, s_jerk * 1.1)

        # --- False Positive Dampeners ---
        # A. Sports / Running dampener (unidirectional high linearity)
        d_sports = 0.0
        path_len_1 = sum(
            speed1_list[i] * max(1e-4, self.history[i + 1][0] - self.history[i][0])
            for i in range(len(speed1_list))
        )
        path_len_2 = sum(
            speed2_list[i] * max(1e-4, self.history[i + 1][0] - self.history[i][0])
            for i in range(len(speed2_list))
        )
        net_disp_1 = float(
            np.hypot(
                self.history[-1][3][0] - self.history[0][3][0],
                self.history[-1][3][1] - self.history[0][3][1],
            )
        )
        net_disp_2 = float(
            np.hypot(
                self.history[-1][4][0] - self.history[0][4][0],
                self.history[-1][4][1] - self.history[0][4][1],
            )
        )
        lin_1 = net_disp_1 / max(1.0, path_len_1)
        lin_2 = net_disp_2 / max(1.0, path_len_2)

        if lin_1 >= cfg.SPORTS_LINEARITY_THRESH and lin_2 >= cfg.SPORTS_LINEARITY_THRESH and mean_speed > 35.0:
            avg_lin = (lin_1 + lin_2) / 2.0
            d_sports = cfg.SPORTS_DAMPENER_WEIGHT * avg_lin

        # B. Friendly Hug dampener (high contact overlap but calm/minimal movement)
        d_friendly = 0.0
        if mean_overlap >= 0.04 or mean_dist < 0.40 * scale:
            if mean_speed <= cfg.HUG_CALM_MOTION_THRESH and std_speed <= 30.0:
                d_friendly = cfg.HUG_DAMPENER_WEIGHT

        # C. Dancing / Coordinated Movement dampener (synchronized velocity correlation)
        d_dance = 0.0
        coord_sims = []
        for i in range(len(v1_list)):
            sp1 = speed1_list[i]
            sp2 = speed2_list[i]
            if sp1 > 5.0 and sp2 > 5.0:
                cos_sim = (v1_list[i][0] * v2_list[i][0] + v1_list[i][1] * v2_list[i][1]) / (sp1 * sp2)
                coord_sims.append(cos_sim)
        avg_coord = float(np.mean(coord_sims)) if coord_sims else 0.0
        dist_std = float(np.std(dist_list)) if dist_list else 0.0

        if avg_coord >= 0.50 and dist_std < 30.0 and mean_speed > 10.0:
            d_dance = cfg.DANCE_DAMPENER_WEIGHT * max(0.5, avg_coord)


        # D. Crowd dampener (high scene density)
        d_crowd = 0.0
        if scene_people_count >= cfg.CROWD_DENSITY_THRESH:
            excess = scene_people_count - cfg.CROWD_DENSITY_THRESH
            d_crowd = min(0.35, cfg.CROWD_DAMPENER_SCALE * (1.0 + excess))

        # Composite Confidence
        raw_conf = (
            cfg.WEIGHT_PROXIMITY * s_prox
            + cfg.WEIGHT_JERK * s_jerk
            + cfg.WEIGHT_GRAPPLE * s_grapple
            + cfg.WEIGHT_LIMBS * s_limbs
        )
        total_dampeners = d_sports + d_friendly + d_dance + d_crowd
        conf = float(np.clip(raw_conf - total_dampeners, 0.0, 1.0))
        self.confidence = conf
        self.last_metrics = {
            "conf": conf,
            "raw_conf": raw_conf,
            "s_prox": s_prox,
            "s_jerk": s_jerk,
            "s_grapple": s_grapple,
            "s_limbs": s_limbs,
            "d_sports": d_sports,
            "d_friendly": d_friendly,
            "d_dance": d_dance,
            "d_crowd": d_crowd,
            "mean_accel": mean_accel,
            "mean_speed": mean_speed,
            "mean_overlap": mean_overlap,
        }

        # State transitions
        if not is_near:
            self.state = InterPersonState.CLEAR
            self.conflict_start_time = None
        else:
            if conf < cfg.FIGHT_SUSPICIOUS_THRESHOLD:
                self.state = InterPersonState.PROXIMITY
                self.conflict_start_time = None
            else:
                if self.conflict_start_time is None:
                    self.conflict_start_time = now
                conflict_duration = now - self.conflict_start_time

                if conf >= cfg.FIGHT_CONF_THRESHOLD:
                    if conflict_duration >= cfg.FIGHT_MIN_DURATION:
                        if now - self.last_alert_time >= cfg.FIGHT_PAIR_ALERT_COOLDOWN:
                            detail = (
                                f"Track #{self.person_a_id} & #{self.person_b_id}: "
                                f"sustained physical struggle ({conflict_duration:.1f}s, conf={conf:.2f}), "
                                f"erratic jerk={mean_accel:.0f}px/s², overlap={mean_overlap * 100:.1f}%. "
                                f"Sports/hug filters cleared. "
                                f"Human verification required. Experimental heuristic baseline."
                            )
                            events.append(("POSSIBLE_ALTERCATION", detail))
                            self.last_alert_time = now
                        self.state = InterPersonState.ALERTED
                    else:
                        self.state = InterPersonState.SUSPICIOUS
                else:
                    self.state = InterPersonState.SUSPICIOUS

        return events


# ---------------------------------------------------------------------------
# Per-person Fall Detection State Machine (unchanged logic)
# ---------------------------------------------------------------------------


class TrackState:
    """Encapsulates temporal trajectory and fall state machine for a single tracked person."""

    def __init__(self, track_id: int):
        self.track_id = track_id
        self.state = PersonState.UPRIGHT
        self.history = deque(maxlen=cfg.HISTORY_MAXLEN)
        self.last_seen = time.time()
        self.fall_start_time: Optional[float] = None
        self.ground_start_time: Optional[float] = None
        self.last_alert_time: float = 0.0
        self.drop_metrics: Dict[str, float] = {}

    def update(self, person: PersonDetection, frame_height: int, now: Optional[float] = None):
        if now is None:
            now = time.time()

        self.last_seen = now
        bbox = person.bbox
        x1, y1, x2, y2 = bbox
        width = max(1.0, float(x2 - x1))
        height = max(1.0, float(y2 - y1))
        center_y = (y1 + y2) / 2.0
        aspect_ratio = width / height

        torso_angle = calculate_torso_angle(
            person.keypoints, person.keypoint_conf, cfg.KEYPOINT_CONF_THRESHOLD
        )

        if torso_angle is not None:
            is_horizontal = (
                torso_angle <= cfg.TORSO_HORIZONTAL_THRESH_DEG
                or aspect_ratio >= cfg.FALL_ASPECT_RATIO
            )
            is_upright = (
                torso_angle >= cfg.TORSO_UPRIGHT_THRESH_DEG
                and aspect_ratio <= cfg.UPRIGHT_ASPECT_RATIO
            )
        else:
            is_horizontal = aspect_ratio >= cfg.FALL_ASPECT_RATIO
            is_upright = aspect_ratio <= cfg.UPRIGHT_ASPECT_RATIO

        snapshot = {
            "time": now,
            "center_y": center_y,
            "height": height,
            "aspect_ratio": aspect_ratio,
            "torso_angle": torso_angle,
            "is_horizontal": is_horizontal,
            "is_upright": is_upright,
        }
        self.history.append(snapshot)

        events = []

        if self.state == PersonState.UPRIGHT:
            drop = self._detect_sudden_descent(now, center_y, frame_height)
            if drop is not None:
                self.drop_metrics = drop
                self.fall_start_time = now
                self.state = PersonState.DESCENT_DETECTED

        if self.state == PersonState.DESCENT_DETECTED:
            if is_horizontal:
                self.ground_start_time = now
                self.state = PersonState.ON_GROUND
            elif now - self.fall_start_time > cfg.FALL_DESCENT_MAX_TIME:
                self.state = PersonState.UPRIGHT
                self.fall_start_time = None

        elif self.state == PersonState.ON_GROUND:
            if is_upright:
                self.state = PersonState.UPRIGHT
                self.ground_start_time = None
                self.fall_start_time = None
            else:
                elapsed_on_ground = now - (self.ground_start_time or now)
                if elapsed_on_ground >= cfg.FALL_GROUND_TIME:
                    if now - self.last_alert_time >= cfg.TRACK_ALERT_COOLDOWN:
                        dy = self.drop_metrics.get("dy", 0.0)
                        vel = self.drop_metrics.get("vel", 0.0)
                        dt = self.drop_metrics.get("dt", 0.0)
                        angle_str = (
                            f"{torso_angle:.1f}°" if torso_angle is not None else "N/A"
                        )
                        detail = (
                            f"Track #{self.track_id}: Sudden descent (dy={dy:.0f}px in {dt:.2f}s, "
                            f"vel={vel:.2f}H/s), horizontal posture ({angle_str}), "
                            f"remained on ground for {elapsed_on_ground:.1f}s. "
                            f"Human verification required."
                        )
                        events.append(("POSSIBLE_FALL", detail))
                        self.last_alert_time = now
                    self.state = PersonState.ALERTED

        elif self.state == PersonState.ALERTED:
            if is_upright:
                self.state = PersonState.UPRIGHT
                self.fall_start_time = None
                self.ground_start_time = None

        return events

    def _detect_sudden_descent(
        self, now: float, current_y: float, frame_height: int
    ) -> Optional[Dict[str, float]]:
        if len(self.history) < cfg.MIN_HISTORY_FRAMES:
            return None

        for past in self.history:
            dt = now - past["time"]
            if cfg.FALL_DESCENT_MIN_TIME <= dt <= cfg.FALL_DESCENT_MAX_TIME:
                dy = current_y - past["center_y"]
                drop_ratio = dy / max(1.0, float(frame_height))
                norm_velocity = drop_ratio / dt

                if (
                    drop_ratio >= cfg.FALL_MIN_DESCENT_DELTA_RATIO
                    and norm_velocity >= cfg.FALL_VELOCITY_THRESH
                    and not past["is_horizontal"]
                ):
                    return {"dy": dy, "dt": dt, "vel": norm_velocity, "drop_ratio": drop_ratio}
        return None


# ---------------------------------------------------------------------------
# Top-level Rule Engine
# ---------------------------------------------------------------------------

class EventRuleEngine:
    """Evaluates persistent tracking state and heuristic safety event rules."""

    def __init__(
        self,
        max_inactive_sec: float = cfg.TRACK_MAX_INACTIVE_SEC,
        dog_max_inactive_sec: float = cfg.DOG_MAX_INACTIVE_SEC,
    ):
        # Per-person fall tracking
        self.tracks: Dict[int, TrackState] = {}
        self.max_inactive_sec = max_inactive_sec

        # Per (person_id, dog_id) pair interaction tracking
        self._pair_states: Dict[Tuple[int, int], PairInteractionState] = {}
        self.dog_max_inactive_sec = dog_max_inactive_sec

        # Per (person_a_id, person_b_id) pair interaction tracking
        self._person_pair_states: Dict[Tuple[int, int], PersonPairInteractionState] = {}
        self.fight_max_inactive_sec = cfg.FIGHT_MAX_INACTIVE_SEC

    # --- Fall Detection ---

    def evaluate_person(
        self, person: PersonDetection, frame_height: int, now: Optional[float] = None
    ) -> List[Tuple[str, str]]:
        """Updates tracking and evaluates temporal fall detection for a single person."""
        if now is None:
            now = time.time()

        track_id = person.track_id
        if track_id not in self.tracks:
            self.tracks[track_id] = TrackState(track_id)

        return self.tracks[track_id].update(person, frame_height, now=now)

    def cleanup_inactive_tracks(self, now: Optional[float] = None):
        """Removes stale person tracks and interaction pairs to keep memory low."""
        if now is None:
            now = time.time()
        stale = [
            t_id
            for t_id, state in self.tracks.items()
            if now - state.last_seen > self.max_inactive_sec
        ]
        for t_id in stale:
            del self.tracks[t_id]

        stale_pairs = [
            k
            for k, v in self._person_pair_states.items()
            if now - v.last_seen > self.fight_max_inactive_sec
        ]
        for k in stale_pairs:
            del self._person_pair_states[k]

    # --- Dog Interaction Detection ---

    def evaluate_dog_interactions(
        self,
        people: List[PersonDetection],
        dogs: List[DogDetection],
        now: Optional[float] = None,
    ) -> List[Tuple[str, str]]:
        """
        Evaluates all (person, dog) pair combinations with temporal interaction tracking.
        Only emits POSSIBLE_DOG_ATTACK when proximity + overlap + movement burst cues
        are ALL sustained beyond their configured minimum durations.
        """
        if now is None:
            now = time.time()

        events: List[Tuple[str, str]] = []
        active_pairs = set()

        for person in people:
            for dog in dogs:
                key = (person.track_id, dog.track_id)
                active_pairs.add(key)

                if key not in self._pair_states:
                    self._pair_states[key] = PairInteractionState(person.track_id, dog.track_id)

                pair_events = self._pair_states[key].update(person, dog, now=now)
                events.extend(pair_events)

        # Purge pairs that have not been observed recently
        stale_pairs = [
            k
            for k, v in self._pair_states.items()
            if now - v.last_seen > self.dog_max_inactive_sec
        ]
        for k in stale_pairs:
            del self._pair_states[k]

        return events

    def get_dog_pair_state(
        self, person_id: int, dog_id: int
    ) -> Optional[DogInteractionState]:
        """Returns current interaction state for a specific (person, dog) pair, or None."""
        pair = self._pair_states.get((person_id, dog_id))
        return pair.state if pair is not None else None

    # --- Person-to-Person Altercation Detection ---

    def evaluate_person_interactions(
        self,
        people: List[PersonDetection],
        now: Optional[float] = None,
    ) -> List[Tuple[str, str]]:
        """
        Evaluates all (person_i, person_j) combinations for physical altercations
        using temporal sequence analysis and false positive suppression.
        """
        if now is None:
            now = time.time()

        events: List[Tuple[str, str]] = []
        n_people = len(people)
        active_pairs = set()

        for i in range(n_people):
            for j in range(i + 1, n_people):
                p1, p2 = people[i], people[j]
                pid1, pid2 = min(p1.track_id, p2.track_id), max(p1.track_id, p2.track_id)
                key = (pid1, pid2)
                active_pairs.add(key)

                if key not in self._person_pair_states:
                    self._person_pair_states[key] = PersonPairInteractionState(pid1, pid2)

                pair_events = self._person_pair_states[key].update(
                    p1, p2, scene_people_count=n_people, now=now
                )
                events.extend(pair_events)

        # Stale pair cleanup
        stale_pairs = [
            k
            for k, v in self._person_pair_states.items()
            if now - v.last_seen > self.fight_max_inactive_sec
        ]
        for k in stale_pairs:
            del self._person_pair_states[k]

        return events

    def get_person_pair_state(self, p1_id: int, p2_id: int) -> Optional[InterPersonState]:
        """Returns current interaction state for a specific person pair, or None."""
        key = (min(p1_id, p2_id), max(p1_id, p2_id))
        pair = self._person_pair_states.get(key)
        return pair.state if pair is not None else None

    def get_person_pair_confidence(self, p1_id: int, p2_id: int) -> float:
        """Returns current altercation confidence score for a person pair (0.0 to 1.0)."""
        key = (min(p1_id, p2_id), max(p1_id, p2_id))
        pair = self._person_pair_states.get(key)
        return pair.confidence if pair is not None else 0.0

