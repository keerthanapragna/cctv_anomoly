"""
Interactive Staged Test Runner for Campus CCTV Monitoring Pipeline.

Fall Detection Scenarios:
  1. Normal Standing & Walking
  2. Sitting Down in a Chair
  3. Bending Down to Tie Shoes
  4. Kneeling Down
  5. Lying Down Gradually
  6. Sudden Fall with Sustained Ground Inactivity
  7. Stumble/Trip with Quick Recovery

Dog Interaction Scenarios:
  8. Passing Dog (False Positive Rejection)
  9. Stationary Dog, Person Motionless (False Positive Rejection)
  10. Staged Aggressive Interaction (Expected: POSSIBLE_DOG_ATTACK)

Usage:
    python src/staged_tests.py
"""

import sys
from pathlib import Path
import numpy as np

# Ensure root directory is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import src.config as cfg
from src.detector import PersonDetection, DogDetection
from src.event_rules import EventRuleEngine
from tests.test_fall_detection import make_keypoints

def run_stage(title, frames_generator, engine, frame_height=480):
    print(f"\n[TEST STAGE] {title}")
    alerts_fired = []
    last_p = None

    for frame_idx, (t, p) in enumerate(frames_generator()):
        last_p = p
        events = engine.evaluate_person(p, frame_height, now=t)
        for evt, detail in events:
            alerts_fired.append((evt, detail))
            print(f"  --> ALERT FIRED: {evt} | {detail}")

    track_state = engine.tracks.get(last_p.track_id) if last_p else None
    state_str = track_state.state.value if track_state else "UNKNOWN"
    print(f"  Result: {len(alerts_fired)} alert(s) fired. Final Track State: {state_str}")
    return alerts_fired


def run_dog_stage(title, frames_spec, engine):
    """Drives the dog interaction rule engine with (dt, people, dogs) tuples."""
    print(f"\n[TEST STAGE] {title}")
    alerts_fired = []
    t = 1000.0   # Start well past epoch-zero so cooldown check (now - 0.0 >= 20s) always passes
    final_state_str = "N/A"

    for dt, people, dogs in frames_spec:
        t += dt
        events = engine.evaluate_dog_interactions(people, dogs, now=t)
        for evt, detail in events:
            alerts_fired.append((evt, detail))
            print(f"  --> ALERT FIRED: {evt} | {detail}")

    # Report all active pair states
    pair_states = [
        f"({pid},{did})={s.state.value}"
        for (pid, did), s in engine._pair_states.items()
    ]
    final_state_str = ", ".join(pair_states) if pair_states else "no active pairs"
    print(f"  Result: {len(alerts_fired)} alert(s) fired. Pair States: {final_state_str}")
    return alerts_fired


def run_altercation_stage(title, frames_spec, engine):
    """Drives the person interaction rule engine with (dt, [PersonDetection, ...]) tuples."""
    print(f"\n[TEST STAGE] {title}")
    alerts_fired = []
    t = 1000.0

    for dt, people in frames_spec:
        t += dt
        events = engine.evaluate_person_interactions(people, now=t)
        for evt, detail in events:
            alerts_fired.append((evt, detail))
            print(f"  --> ALERT FIRED: {evt} | {detail}")

    pair_states = [
        f"({pid1},{pid2})={s.state.value} (conf={s.confidence:.2f})"
        for (pid1, pid2), s in engine._person_pair_states.items()
    ]
    final_state_str = ", ".join(pair_states) if pair_states else "no active pairs"
    print(f"  Result: {len(alerts_fired)} alert(s) fired. Pair States: {final_state_str}")
    return alerts_fired



def main():
    print("=" * 70)
    print("Campus CCTV - Heuristic Fall Detection Staged Verification")
    print(cfg.DISCLAIMER)
    print("=" * 70)

    engine = EventRuleEngine()

    # Scenario 1: Walking
    def gen_walking():
        t = 0.0
        for i in range(25):
            t += 0.05
            cx = 100 + i * 8
            cy = 240
            bbox = np.array([cx - 25, cy - 80, cx + 25, cy + 80])
            kpts, confs = make_keypoints(85.0, cx, cy)
            yield t, PersonDetection(track_id=101, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 1: Normal Walking (Upright)", gen_walking, engine)

    # Scenario 2: Sitting
    def gen_sitting():
        t = 10.0
        # Stand
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 100, 270, 300])
            kpts, confs = make_keypoints(85.0, 235, 200)
            yield t, PersonDetection(track_id=102, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        # Controlled descent over 1.2s, torso stays upright (~75°)
        for step in range(20):
            t += 0.06
            y1 = 100 + step * 5
            y2 = 300 + step * 2
            bbox = np.array([190, y1, 280, y2])
            kpts, confs = make_keypoints(75.0, 235, (y1 + y2) / 2)
            yield t, PersonDetection(track_id=102, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        # Sits
        for _ in range(30):
            t += 0.06
            bbox = np.array([190, 200, 285, 350])
            kpts, confs = make_keypoints(75.0, 235, 275)
            yield t, PersonDetection(track_id=102, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 2: Sitting Down (False Positive Rejection)", gen_sitting, engine)

    # Scenario 3: Bending
    def gen_bending():
        t = 20.0
        for _ in range(8):
            t += 0.05
            bbox = np.array([200, 120, 270, 320])
            kpts, confs = make_keypoints(85.0, 235, 220)
            yield t, PersonDetection(track_id=103, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for _ in range(10):
            t += 0.06
            bbox = np.array([200, 180, 290, 320])
            kpts, confs = make_keypoints(30.0, 245, 250)
            yield t, PersonDetection(track_id=103, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for _ in range(10):
            t += 0.06
            bbox = np.array([200, 120, 270, 320])
            kpts, confs = make_keypoints(85.0, 235, 220)
            yield t, PersonDetection(track_id=103, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 3: Bending Down (False Positive Rejection)", gen_bending, engine)

    # Scenario 4: Kneeling
    def gen_kneeling():
        t = 30.0
        for _ in range(8):
            t += 0.05
            bbox = np.array([200, 100, 260, 300])
            kpts, confs = make_keypoints(85.0, 230, 200)
            yield t, PersonDetection(track_id=104, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for _ in range(25):
            t += 0.06
            bbox = np.array([200, 200, 280, 340])
            kpts, confs = make_keypoints(80.0, 240, 270)
            yield t, PersonDetection(track_id=104, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 4: Kneeling Down (False Positive Rejection)", gen_kneeling, engine)

    # Scenario 5: Gradual Lying Down
    def gen_slow_lying():
        t = 40.0
        for _ in range(8):
            t += 0.05
            bbox = np.array([200, 100, 270, 300])
            kpts, confs = make_keypoints(85.0, 235, 200)
            yield t, PersonDetection(track_id=105, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for step in range(40):
            t += 0.08
            frac = step / 40.0
            y1 = 100 + frac * 250
            y2 = 300 + frac * 100
            angle = 85.0 - frac * 75.0
            bbox = np.array([200 - frac * 50, y1, 270 + frac * 80, y2])
            kpts, confs = make_keypoints(angle, 250, (y1 + y2) / 2)
            yield t, PersonDetection(track_id=105, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 5: Slow / Gentle Lying Down (False Positive Rejection)", gen_slow_lying, engine)

    # Scenario 6: True Sudden Fall with Sustained Ground Inactivity
    def gen_true_fall():
        t = 50.0
        # Stand
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 80, 270, 280])
            kpts, confs = make_keypoints(85.0, 235, 180)
            yield t, PersonDetection(track_id=106, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        # Drop fast (in 0.25s)
        for i in range(5):
            t += 0.05
            cy = 180 + (i + 1) * 36
            bbox = np.array([180, cy - 40, 320, cy + 40])
            kpts, confs = make_keypoints(85.0 - (i + 1) * 15.0, 250, cy)
            yield t, PersonDetection(track_id=106, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        # Remains on ground
        for _ in range(40):
            t += 0.05
            bbox = np.array([160, 350, 360, 420])
            kpts, confs = make_keypoints(15.0, 260, 385)
            yield t, PersonDetection(track_id=106, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 6: Sudden Fall & Stays on Ground (Expected: POSSIBLE_FALL)", gen_true_fall, engine)

    # Scenario 7: Stumble and Quick Recovery
    def gen_stumble_recovery():
        t = 60.0
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 80, 270, 280])
            kpts, confs = make_keypoints(85.0, 235, 180)
            yield t, PersonDetection(track_id=107, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for i in range(5):
            t += 0.05
            cy = 180 + (i + 1) * 36
            bbox = np.array([180, cy - 40, 320, cy + 40])
            kpts, confs = make_keypoints(25.0, 250, cy)
            yield t, PersonDetection(track_id=107, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for _ in range(8):
            t += 0.05
            bbox = np.array([160, 350, 360, 420])
            kpts, confs = make_keypoints(15.0, 260, 385)
            yield t, PersonDetection(track_id=107, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
        for _ in range(15):
            t += 0.05
            bbox = np.array([200, 80, 270, 280])
            kpts, confs = make_keypoints(85.0, 235, 180)
            yield t, PersonDetection(track_id=107, bbox=bbox, keypoints=kpts, keypoint_conf=confs)

    run_stage("Scenario 7: Stumble & Quick Recovery (False Positive Rejection)", gen_stumble_recovery, engine)

    # -----------------------------------------------------------------------
    # Dog Interaction Scenarios — each gets a fresh engine to prevent bleed-over
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("Dog Interaction Staged Scenarios")
    print("=" * 70)

    def _p(cx, cy, pid=1):
        bbox = np.array([cx - 30, cy - 80, cx + 30, cy + 80], dtype=np.float32)
        return PersonDetection(track_id=pid, bbox=bbox)

    def _d(cx, cy, did=1):
        bbox = np.array([cx - 40, cy - 25, cx + 40, cy + 25], dtype=np.float32)
        return DogDetection(track_id=did, bbox=bbox, conf=0.8)

    # Scenario 8: Passing Dog
    eng8 = EventRuleEngine()
    dog_pass_frames = []
    person_cx, person_cy = 320, 300
    for i in range(20):
        dog_cx = 600 - i * 22
        close = abs(dog_cx - person_cx) < 160
        dog_list = [_d(dog_cx, person_cy)] if close else []
        dog_pass_frames.append((0.05, [_p(person_cx, person_cy)], dog_list))
    run_dog_stage("Scenario 8: Passing Dog (False Positive Rejection)", dog_pass_frames, eng8)

    # Scenario 9: Stationary Dog, Person Still
    eng9 = EventRuleEngine()
    dog_still_frames = [
        (0.05, [_p(320, 300)], [_d(400, 300)])  # side by side, no overlap
        for _ in range(100)  # 5 seconds
    ]
    run_dog_stage("Scenario 9: Stationary Dog, Person Still (False Positive Rejection)", dog_still_frames, eng9)

    # Scenario 10: Staged Aggressive Interaction
    eng10 = EventRuleEngine()
    dog_attack_frames = []
    # Phase 1: 1.2s proximity buildup (dog at side)
    for _ in range(24):
        dog_attack_frames.append((0.05, [_p(320, 300)], [_d(360, 300)]))
    # Phase 2: Dog overlaps person + person jostles vigorously for 3s
    for i in range(60):
        jitter_x = 320 + (25 if i % 2 == 0 else -25)
        dog_attack_frames.append((0.05, [_p(jitter_x, 300)], [_d(320, 300)]))
    run_dog_stage("Scenario 10: Staged Aggressive Interaction (Expected: POSSIBLE_DOG_ATTACK)", dog_attack_frames, eng10)

    # -----------------------------------------------------------------------
    # Person-to-Person Altercation Scenarios — each gets a fresh engine
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("Person-to-Person Altercation & Interaction Staged Scenarios")
    print(cfg.DISCLAIMER)
    print("=" * 70)

    # Scenario 11: Friendly Hug / Embrace (False Positive Rejection)
    eng11 = EventRuleEngine()
    hug_frames = [
        (0.05, [_p(300.0, 250.0, pid=1), _p(308.0, 250.0, pid=2)])
        for _ in range(35)
    ]
    run_altercation_stage("Scenario 11: Friendly Hug / Embrace (False Positive Rejection)", hug_frames, eng11)

    # Scenario 12: Jogging / Sprinting (Sports False Positive Rejection)
    eng12 = EventRuleEngine()
    sports_frames = []
    for i in range(35):
        cx = 100.0 + i * 15.0   # fast unidirectional sprint (300 px/s)
        sports_frames.append((0.05, [_p(cx, 240.0, pid=1), _p(cx + 25.0, 245.0, pid=2)]))
    run_altercation_stage("Scenario 12: Jogging / Sprinting Side-by-Side (Sports False Positive Rejection)", sports_frames, eng12)

    # Scenario 13: Dancing / Coordinated Movement (False Positive Rejection)
    eng13 = EventRuleEngine()
    dance_frames = []
    for i in range(35):
        step = 15.0 * np.sin(i * 0.25)
        dance_frames.append((0.05, [_p(300.0 + step, 250.0, pid=1), _p(335.0 + step, 250.0, pid=2)]))
    run_altercation_stage("Scenario 13: Dancing / Coordinated Movement (False Positive Rejection)", dance_frames, eng13)

    # Scenario 14: Dense Crowd Walking (False Positive Rejection)
    eng14 = EventRuleEngine()
    crowd_frames = []
    for i in range(30):
        people = [
            _p(300 + i * 2, 240, pid=1),
            _p(325 + i * 2, 245, pid=2),
            _p(280 + i * 2, 250, pid=3),
            _p(350 + i * 2, 240, pid=4),
            _p(310 + i * 2, 260, pid=5),
        ]
        crowd_frames.append((0.05, people))
    run_altercation_stage("Scenario 14: Dense Crowd Walking (False Positive Rejection)", crowd_frames, eng14)

    # Scenario 15: Staged Physical Altercation (Expected: POSSIBLE_ALTERCATION)
    eng15 = EventRuleEngine()
    fight_frames = []
    for i in range(35):
        jitter1 = 25.0 * np.sin(i * 2.5) + (15.0 if i % 2 == 0 else -15.0)
        jitter2 = -20.0 * np.sin(i * 2.5) + (-15.0 if i % 2 == 0 else 15.0)
        p1 = _p(300 + jitter1, 250 + (10.0 if i % 3 == 0 else -10.0), pid=1)
        p2 = _p(320 + jitter2, 250 + (-10.0 if i % 3 == 0 else 10.0), pid=2)
        fight_frames.append((0.05, [p1, p2]))
    run_altercation_stage("Scenario 15: Staged Physical Altercation (Expected: POSSIBLE_ALTERCATION)", fight_frames, eng15)

    print("\n" + "=" * 70)
    print("All staged verification scenarios completed.")
    print("=" * 70)



if __name__ == "__main__":
    main()
