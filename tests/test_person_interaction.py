"""
Unit tests for person-to-person interaction & altercation detection baseline.

Scenarios tested:
1. Separated people (no proximity) -> CLEAR, 0 alerts
2. Staged physical altercation (grappling, high jerk, sustained time) -> POSSIBLE_ALTERCATION
3. Sports / Running together (high speed, high path linearity) -> 0 alerts (sports dampener)
4. Friendly hug / embrace (high overlap, calm stationary motion) -> 0 alerts (hug dampener)
5. Dancing / coordinated movement (smooth rhythmic motion, low jerk) -> 0 alerts (dance dampener)
6. Dense crowd (5 people nearby, calm ambient movement) -> 0 alerts (crowd dampener)
7. Fleeting contact / bump (drops out before minimum duration) -> 0 alerts
8. Alert cooldown throttling -> only 1 alert fired within cooldown window
9. State machine transitions (CLEAR -> PROXIMITY -> SUSPICIOUS -> ALERTED -> CLEAR)
"""

import sys
from pathlib import Path
import unittest
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.detector import PersonDetection
from src.event_rules import EventRuleEngine, InterPersonState
import src.config as cfg
from tests.test_fall_detection import make_keypoints


def _person(pid: int, cx: float, cy: float, w: float = 60, h: float = 160) -> PersonDetection:
    """Helper to create PersonDetection with bounding box centered at (cx, cy)."""
    bbox = np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], dtype=np.float32)
    kpts, confs = make_keypoints(90.0, cx, cy)
    return PersonDetection(track_id=pid, bbox=bbox, keypoints=kpts, keypoint_conf=confs)


def _run_sequence(engine: EventRuleEngine, frame_sequence, now_start: float = 1000.0):
    """Feeds a sequence of (dt, [PersonDetection, ...]) into the engine."""
    events = []
    t = now_start
    for dt, people in frame_sequence:
        t += dt
        evts = engine.evaluate_person_interactions(people, now=t)
        events.extend(evts)
    return events, t


class TestPersonInteractionBaseline(unittest.TestCase):

    def test_separated_people_no_alert(self):
        """Two people walking far apart must remain CLEAR with 0 alerts."""
        engine = EventRuleEngine()
        frames = []
        for i in range(20):
            p1 = _person(1, cx=100 + i * 2, cy=250)
            p2 = _person(2, cx=500 + i * 2, cy=250)
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)
        state = engine.get_person_pair_state(1, 2)
        self.assertEqual(state, InterPersonState.CLEAR)
        self.assertEqual(engine.get_person_pair_confidence(1, 2), 0.0)

    def test_staged_altercation_alerts(self):
        """Two people in sustained physical struggle with erratic jerk and grappling must alert."""
        engine = EventRuleEngine()
        frames = []
        # 35 frames at dt=0.05s = 1.75s of intense struggle
        for i in range(35):
            # Rapid back-and-forth erratic motion
            jitter1 = 25.0 * np.sin(i * 2.5) + (15.0 if i % 2 == 0 else -15.0)
            jitter2 = -20.0 * np.sin(i * 2.5) + (-15.0 if i % 2 == 0 else 15.0)
            p1 = _person(1, cx=300 + jitter1, cy=250 + (10.0 if i % 3 == 0 else -10.0))
            p2 = _person(2, cx=320 + jitter2, cy=250 + (-10.0 if i % 3 == 0 else 10.0))
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertGreaterEqual(len(events), 1)
        evt_type, detail = events[0]
        self.assertEqual(evt_type, "POSSIBLE_ALTERCATION")
        self.assertIn("Human verification required", detail)
        self.assertIn("Track #1 & #2", detail)
        self.assertEqual(engine.get_person_pair_state(1, 2), InterPersonState.ALERTED)
        self.assertGreaterEqual(engine.get_person_pair_confidence(1, 2), cfg.FIGHT_CONF_THRESHOLD)

    def test_sports_running_rejected_by_dampener(self):
        """Two people sprinting along parallel tracks must be suppressed by the sports dampener."""
        engine = EventRuleEngine()
        frames = []
        # Both sprinting rapidly to the right (unidirectional, linearity ~ 1.0)
        for i in range(35):
            cx = 100.0 + i * 15.0   # 300 px/sec unidirectional sprint
            p1 = _person(1, cx=cx, cy=240)
            p2 = _person(2, cx=cx + 25.0, cy=245)  # Nearby side-by-side running
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)
        self.assertNotEqual(engine.get_person_pair_state(1, 2), InterPersonState.ALERTED)
        conf = engine.get_person_pair_confidence(1, 2)
        self.assertLess(conf, cfg.FIGHT_CONF_THRESHOLD)

    def test_friendly_hug_rejected_by_dampener(self):
        """Two people embracing with high overlap but calm/stationary motion must be suppressed."""
        engine = EventRuleEngine()
        frames = []
        # High overlap, barely moving (< 5 px/sec)
        for i in range(35):
            p1 = _person(1, cx=300.0 + (0.5 if i % 2 == 0 else 0.0), cy=250.0)
            p2 = _person(2, cx=308.0 + (0.5 if i % 2 == 0 else 0.0), cy=250.0)
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)
        self.assertNotEqual(engine.get_person_pair_state(1, 2), InterPersonState.ALERTED)
        conf = engine.get_person_pair_confidence(1, 2)
        self.assertLess(conf, cfg.FIGHT_CONF_THRESHOLD)

    def test_dancing_rejected_by_dampener(self):
        """Two people moving rhythmically with low acceleration jerk must be suppressed."""
        engine = EventRuleEngine()
        frames = []
        # Smooth sinusoidal dance step: continuous acceleration, no abrupt impact spikes
        for i in range(35):
            step = 15.0 * np.sin(i * 0.25)
            p1 = _person(1, cx=300.0 + step, cy=250.0)
            p2 = _person(2, cx=335.0 + step, cy=250.0)
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)
        self.assertNotEqual(engine.get_person_pair_state(1, 2), InterPersonState.ALERTED)

    def test_dense_crowd_dampened(self):
        """In a dense group of 5 people walking calmly, crowd dampening prevents false positives."""
        engine = EventRuleEngine()
        frames = []
        for i in range(30):
            people = [
                _person(1, cx=300 + i * 2, cy=240),
                _person(2, cx=325 + i * 2, cy=245),
                _person(3, cx=280 + i * 2, cy=250),
                _person(4, cx=350 + i * 2, cy=240),
                _person(5, cx=310 + i * 2, cy=260),
            ]
            frames.append((0.05, people))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)

    def test_fleeting_bump_does_not_alert(self):
        """A brief bump of 0.3s before separating must NOT trigger an alert."""
        engine = EventRuleEngine()
        frames = []
        # Brief 6 frames (0.3s) of contact
        for i in range(6):
            jitter = 15.0 if i % 2 == 0 else -15.0
            p1 = _person(1, cx=300 + jitter, cy=250)
            p2 = _person(2, cx=315 - jitter, cy=250)
            frames.append((0.05, [p1, p2]))
        # Followed by moving far apart
        for i in range(15):
            p1 = _person(1, cx=150 - i * 5, cy=250)
            p2 = _person(2, cx=450 + i * 5, cy=250)
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        self.assertEqual(len(events), 0)
        self.assertEqual(engine.get_person_pair_state(1, 2), InterPersonState.CLEAR)

    def test_alert_cooldown_throttles_subsequent_alerts(self):
        """Once alerted, subsequent frames within cooldown period do NOT fire duplicate alerts."""
        engine = EventRuleEngine()
        frames = []
        # 60 frames (3.0 seconds) of sustained fight
        for i in range(60):
            jitter = 20.0 if i % 2 == 0 else -20.0
            p1 = _person(1, cx=300 + jitter, cy=250)
            p2 = _person(2, cx=320 - jitter, cy=250)
            frames.append((0.05, [p1, p2]))

        events, _ = _run_sequence(engine, frames)
        # Exactly one alert should be fired because cooldown is 20.0s
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][0], "POSSIBLE_ALTERCATION")

    def test_state_machine_separation_resets_to_clear(self):
        """After alerting, when participants separate, state transitions back to CLEAR."""
        engine = EventRuleEngine()
        frames = []
        # First: fight to alert
        for i in range(35):
            jitter = 20.0 if i % 2 == 0 else -20.0
            p1 = _person(1, cx=300 + jitter, cy=250)
            p2 = _person(2, cx=320 - jitter, cy=250)
            frames.append((0.05, [p1, p2]))

        events, t_end = _run_sequence(engine, frames)
        self.assertEqual(engine.get_person_pair_state(1, 2), InterPersonState.ALERTED)

        # Then: separate far apart
        sep_frames = []
        for i in range(10):
            p1 = _person(1, cx=100 - i * 10, cy=250)
            p2 = _person(2, cx=500 + i * 10, cy=250)
            sep_frames.append((0.05, [p1, p2]))

        _run_sequence(engine, sep_frames, now_start=t_end)
        self.assertEqual(engine.get_person_pair_state(1, 2), InterPersonState.CLEAR)


if __name__ == "__main__":
    unittest.main()
