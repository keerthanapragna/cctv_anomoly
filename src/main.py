import sys
import time
from pathlib import Path
from typing import List

# Ensure root directory is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import cv2
import src.config as cfg
from src.camera import Camera
from src.detector import Detector, DogDetection
from src.event_rules import EventRuleEngine, DogInteractionState, InterPersonState
from src.alerts import AlertManager


def main():
    print("=" * 65)
    print("Starting Campus CCTV Monitoring Pipeline")
    print(f"Camera Source   : {cfg.CAMERA_SOURCE}")
    print(f"Pose Model      : {cfg.POSE_MODEL_PATH}")
    print(f"Object Model    : {cfg.OBJECT_MODEL_PATH}")
    print(f"Tracker Type    : {cfg.TRACKER_TYPE}")
    print(f"Fall Thresholds : vel={cfg.FALL_VELOCITY_THRESH}H/s, ground={cfg.FALL_GROUND_TIME}s")
    print(f"Dog Thresholds  : prox={cfg.DOG_PROXIMITY_RATIO}, contact={cfg.DOG_MIN_INTERACTION_TIME}s, burst={cfg.DOG_PERSON_MOVEMENT_BURST}px/s")
    print("=" * 65)

    alert_mgr = AlertManager(cooldown=cfg.ALERT_COOLDOWN, log_file=cfg.ALERT_LOG_FILE)
    detector = Detector(
        pose_model_path=cfg.POSE_MODEL_PATH,
        object_model_path=cfg.OBJECT_MODEL_PATH,
        tracker_type=cfg.TRACKER_TYPE,
    )
    rule_engine = EventRuleEngine(max_inactive_sec=cfg.TRACK_MAX_INACTIVE_SEC)
    camera = Camera(cfg.CAMERA_SOURCE)

    try:
        camera.open()
    except RuntimeError as err:
        print(f"[ERROR] {err}")
        sys.exit(1)

    frame_no = 0
    dogs: List[DogDetection] = []

    try:
        while True:
            ok, frame = camera.read()
            if not ok or frame is None:
                print("End of stream or failed to fetch frame. Exiting...")
                break

            frame_no += 1
            now = time.time()
            frame_height, frame_width = frame.shape[:2]

            # 1. Pose estimation & persistent tracking (every frame)
            people, display = detector.predict_pose(
                frame, img_size=cfg.IMG_SIZE, conf=cfg.CONF_THRESHOLD
            )

            # 2. Object detection (runs periodically to maintain low CPU load)
            if frame_no % cfg.OBJECT_INTERVAL == 0:
                detected_objects = detector.predict_objects(
                    frame,
                    target_classes=("dog",),
                    img_size=cfg.IMG_SIZE,
                    conf=cfg.CONF_THRESHOLD,
                )
                dogs = detected_objects.get("dog", [])

            # 3. Temporal fall detection with body orientation & ground duration
            for person in people:
                fall_events = rule_engine.evaluate_person(person, frame_height, now=now)
                for event_type, detail in fall_events:
                    alert_mgr.trigger(
                        event_type, detail, key_override=f"{event_type}_{person.track_id}"
                    )

                # Visual status badge per person
                track_state = rule_engine.tracks.get(person.track_id)
                if track_state is not None:
                    badge_color = (0, 255, 0)
                    if track_state.state.value == "ALERTED":
                        badge_color = (0, 0, 255)
                    elif track_state.state.value == "ON_GROUND":
                        badge_color = (0, 165, 255)

                    x1, y1 = int(person.bbox[0]), int(person.bbox[1])
                    label = f"ID:{person.track_id} [{track_state.state.value}]"
                    cv2.putText(
                        display,
                        label,
                        (x1, max(20, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        badge_color,
                        2,
                    )

            # 4. Dog proximity & interaction heuristics (temporal, per-pair)
            dog_events = rule_engine.evaluate_dog_interactions(people, dogs, now=now)
            for event_type, detail in dog_events:
                alert_mgr.trigger(event_type, detail)

            # 5. Person-to-Person Altercation Detection (temporal sequence baseline)
            altercation_events = rule_engine.evaluate_person_interactions(people, now=now)
            for event_type, detail in altercation_events:
                alert_mgr.trigger(event_type, detail)

            # 6. Dog bounding-box visual badges
            for dog in dogs:
                pair_state = None
                for person in people:
                    ps = rule_engine.get_dog_pair_state(person.track_id, dog.track_id)
                    if ps is not None:
                        pair_state = ps
                        break  # Use the highest-risk pair state found

                dog_color = (255, 200, 50)   # Default: cyan-ish for neutral dog
                label_suffix = ""
                if pair_state == DogInteractionState.PROXIMITY:
                    dog_color = (0, 165, 255)   # Orange: in proximity watch
                    label_suffix = " [PROX]"
                elif pair_state == DogInteractionState.INTERACTION:
                    dog_color = (0, 80, 255)    # Red-orange: active interaction cues
                    label_suffix = " [INTERACT]"
                elif pair_state == DogInteractionState.ALERTED:
                    dog_color = (0, 0, 255)     # Red: alert dispatched
                    label_suffix = " [!ALERT]"

                dx1, dy1, dx2, dy2 = (
                    int(dog.bbox[0]), int(dog.bbox[1]),
                    int(dog.bbox[2]), int(dog.bbox[3]),
                )
                cv2.rectangle(display, (dx1, dy1), (dx2, dy2), dog_color, 2)
                cv2.putText(
                    display,
                    f"Dog #{dog.track_id}{label_suffix}",
                    (dx1, max(15, dy1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.47,
                    dog_color,
                    2,
                )

            # 7. Person-to-person interaction visual badges
            for i in range(len(people)):
                for j in range(i + 1, len(people)):
                    p1, p2 = people[i], people[j]
                    pstate = rule_engine.get_person_pair_state(p1.track_id, p2.track_id)
                    if pstate in (InterPersonState.SUSPICIOUS, InterPersonState.ALERTED):
                        conf = rule_engine.get_person_pair_confidence(p1.track_id, p2.track_id)
                        c1 = (int((p1.bbox[0] + p1.bbox[2]) / 2), int((p1.bbox[1] + p1.bbox[3]) / 2))
                        c2 = (int((p2.bbox[0] + p2.bbox[2]) / 2), int((p2.bbox[1] + p2.bbox[3]) / 2))
                        mid_x = (c1[0] + c2[0]) // 2
                        mid_y = (c1[1] + c2[1]) // 2
                        line_color = (0, 0, 255) if pstate == InterPersonState.ALERTED else (0, 140, 255)
                        cv2.line(display, c1, c2, line_color, 2)
                        tag = "!ALTERCATION!" if pstate == InterPersonState.ALERTED else "WATCH"
                        cv2.putText(
                            display,
                            f"{tag} ({conf:.2f})",
                            (mid_x - 30, mid_y),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.45,
                            line_color,
                            2,
                        )

            # 8. Low-overhead memory cleanup for departed tracks

            if frame_no % 60 == 0:
                rule_engine.cleanup_inactive_tracks(now=now)

            # 6. UI Header & Disclaimer Overlays
            timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S")
            cv2.putText(
                display,
                f"{cfg.BANNER_TEXT} | {timestamp_str}",
                (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2,
            )
            cv2.putText(
                display,
                cfg.DISCLAIMER,
                (10, frame_height - 15),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                (0, 200, 255),
                1,
            )

            cv2.imshow(cfg.WINDOW_TITLE, display)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                print("User requested exit.")
                break

    except KeyboardInterrupt:
        print("\nShutdown signaled by user.")
    finally:
        camera.release()
        cv2.destroyAllWindows()
        print("Campus CCTV shut down cleanly.")


if __name__ == "__main__":
    main()
