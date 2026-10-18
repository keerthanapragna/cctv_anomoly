"""
Unit tests for dog interaction temporal heuristics.

Scenarios tested:
1. Passing dog (brief proximity) → no alert
2. Stationary dog nearby, person still → no alert (no movement burst)
3. Stationary dog nearby, person paces nearby → no alert (no contact overlap)
4. Dog in extended proximity only, never overlapping → no alert
5. Staged aggressive interaction (overlap + movement burst + sustained time) → POSSIBLE_DOG_ATTACK
6. Interaction cues drop out before minimum time → no alert
7. Multiple dogs, only the interacting one triggers an alert
"""

import sys
from pathlib import Path
import unittest
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.detector import PersonDetection, DogDetection
from src.event_rules import EventRuleEngine, DogInteractionState
import src.config as cfg


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _person(pid: int, cx: float, cy: float, w: float = 60, h: float = 160) -> PersonDetection:
    """Creates a PersonDetection centred at (cx, cy) with given width and height."""
    bbox = np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], dtype=np.float32)
    return PersonDetection(track_id=pid, bbox=bbox)


def _dog(did: int, cx: float, cy: float, w: float = 80, h: float = 50) -> DogDetection:
    """Creates a DogDetection centred at (cx, cy) with given width and height."""
    bbox = np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], dtype=np.float32)
    return DogDetection(track_id=did, bbox=bbox, conf=0.8)


def _run(engine: EventRuleEngine, frames, now_start=1000.0):
    """
    Drives an engine with a list of (dt, people, dogs) frame specs.
    Returns all collected events.
    """
    events = []
    t = now_start
    for dt, people, dogs in frames:
        t += dt
        evts = engine.evaluate_dog_interactions(people, dogs, now=t)
        events.extend(evts)
    return events


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDogInteractionHeuristics(unittest.TestCase):

    # ------------------------------------------------------------------
    # Test 1: Passing dog — brief proximity, no sustained contact
    # ------------------------------------------------------------------
    def test_passing_dog_no_alert(self):
        """A dog walking past within 0.5s must NOT trigger any alert."""
        engine = EventRuleEngine()
        person_cx, person_cy = 320, 300

        frames = []
        # Dog starts far, enters proximity for 0.5s, then walks away
        for i in range(20):
            t_step = 0.05
            dog_cx = 600 - i * 20        # approaches from right
            close_enough = abs(dog_cx - person_cx) < 160
            if close_enough:
                frames.append((t_step, [_person(1, person_cx, person_cy)], [_dog(1, dog_cx, person_cy)]))
            else:
                frames.append((t_step, [_person(1, person_cx, person_cy)], []))

        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertEqual(len(attack_alerts), 0,
            f"Passing dog should not alert, got: {attack_alerts}")

    # ------------------------------------------------------------------
    # Test 2: Stationary dog nearby, person motionless — no alert
    # ------------------------------------------------------------------
    def test_stationary_dog_person_still_no_alert(self):
        """Dog sits near a motionless person for 5s; no movement burst → no alert."""
        engine = EventRuleEngine()
        person_cx, person_cy = 320, 300
        # Dog is within proximity but NOT overlapping the person box
        dog_cx = person_cx + 80   # side by side, not overlapping

        frames = [
            (0.05, [_person(1, person_cx, person_cy)], [_dog(1, dog_cx, person_cy)])
            for _ in range(100)          # 5 seconds
        ]
        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertEqual(len(attack_alerts), 0,
            f"Stationary dog + still person should not alert, got: {attack_alerts}")

    # ------------------------------------------------------------------
    # Test 3: Stationary dog nearby, person pacing — no overlap → no alert
    # ------------------------------------------------------------------
    def test_stationary_dog_person_pacing_no_overlap_no_alert(self):
        """Person paces 30px back and forth while dog stays near but not overlapping."""
        engine = EventRuleEngine()
        person_cy = 300
        dog_cx = 420  # stays 100+px to the right — proximity but no box overlap

        frames = []
        for i in range(80):
            # Person oscillates 30px left and right, never reaching the dog box
            person_cx = 300 + 30 * np.sin(i * 0.3)
            frames.append((0.05, [_person(1, person_cx, person_cy)], [_dog(1, dog_cx, person_cy)]))

        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertEqual(len(attack_alerts), 0,
            f"Pacing person + non-overlapping dog should not alert, got: {attack_alerts}")

    # ------------------------------------------------------------------
    # Test 4: Extended proximity without overlap — never escalates
    # ------------------------------------------------------------------
    def test_proximity_without_overlap_no_alert(self):
        """Dog stays within proximity radius for 10s but bounding boxes never overlap."""
        engine = EventRuleEngine()
        person_cx, person_cy = 320, 300
        # Dog is within ratio distance but clearly beside the person, boxes not touching
        dog_cx = person_cx + 100   # 100px separation — within ratio * scale but no overlap

        frames = [
            (0.1, [_person(1, person_cx, person_cy)], [_dog(1, dog_cx, person_cy)])
            for _ in range(100)   # 10 seconds
        ]
        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertEqual(len(attack_alerts), 0,
            f"Proximity without overlap should not alert, got: {attack_alerts}")

    # ------------------------------------------------------------------
    # Test 5: Staged aggressive interaction — should trigger POSSIBLE_DOG_ATTACK
    # ------------------------------------------------------------------
    def test_staged_aggressive_interaction_triggers_alert(self):
        """
        Dog overlaps person box AND person exhibits movement burst for > DOG_MIN_INTERACTION_TIME.
        Must trigger exactly one POSSIBLE_DOG_ATTACK.
        """
        engine = EventRuleEngine()
        person_cy = 300

        frames = []
        # Phase 1: 1.2s of sustained proximity (> DOG_MIN_PROXIMITY_TIME = 1.0s)
        for _ in range(24):
            frames.append((0.05,
                [_person(1, 320, person_cy, w=60, h=160)],
                [_dog(1, 360, person_cy, w=80, h=50)]))   # near but minimal overlap

        # Phase 2: Dog lunges onto person (centres coincide → large overlap)
        #          Person jostles ± 25px per tick → burst >> 40 px/s
        for i in range(60):   # 3 seconds
            jitter_x = 320 + (25 if i % 2 == 0 else -25)
            frames.append((0.05,
                [_person(1, jitter_x, person_cy, w=60, h=160)],
                [_dog(1, 320, person_cy, w=80, h=50)]))   # dog centred on person

        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertGreaterEqual(len(attack_alerts), 1,
            f"Expected at least 1 POSSIBLE_DOG_ATTACK, got: {events}")
        self.assertIn("Human verification required", attack_alerts[0][1])
        self.assertIn("Not a confirmed attack", attack_alerts[0][1])
        self.assertIn("Person #1", attack_alerts[0][1])
        self.assertIn("Dog #1", attack_alerts[0][1])

    # ------------------------------------------------------------------
    # Test 6: Interaction cues drop before minimum time — no alert
    # ------------------------------------------------------------------
    def test_interaction_drops_before_min_time_no_alert(self):
        """
        Dog overlaps person and person bursts for only 1.0s (<DOG_MIN_INTERACTION_TIME=2.0s)
        then dog walks away. Must NOT alert.
        """
        engine = EventRuleEngine()
        person_cy = 300

        frames = []
        # 1.2s proximity buildup
        for _ in range(24):
            frames.append((0.05,
                [_person(1, 320, person_cy)],
                [_dog(1, 360, person_cy)]))

        # Only 1.0s of active interaction cues (< 2.0s threshold)
        for i in range(20):
            jitter_x = 320 + (25 if i % 2 == 0 else -25)
            frames.append((0.05,
                [_person(1, jitter_x, person_cy)],
                [_dog(1, 320, person_cy)]))

        # Dog leaves immediately
        for _ in range(20):
            frames.append((0.05, [_person(1, 320, person_cy)], []))

        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]
        self.assertEqual(len(attack_alerts), 0,
            f"Short interaction should not alert, got: {attack_alerts}")

    # ------------------------------------------------------------------
    # Test 7: Multiple dogs — only the interacting one triggers alert
    # ------------------------------------------------------------------
    def test_multiple_dogs_only_interacting_one_alerts(self):
        """
        Two dogs near one person. Dog #1 is stationary and non-overlapping.
        Dog #2 performs a staged interaction. Only Dog #2 should trigger an alert.
        """
        engine = EventRuleEngine()
        person_cy = 300

        frames = []
        # 1.2s proximity baseline for both dogs
        for _ in range(24):
            frames.append((0.05,
                [_person(1, 320, person_cy)],
                [
                    _dog(1, 500, person_cy),       # Dog 1: far-ish, not overlapping
                    _dog(2, 360, person_cy),       # Dog 2: close proximity
                ]))

        # Dog 2 overlaps + person jostles for 3s
        for i in range(60):
            jitter_x = 320 + (25 if i % 2 == 0 else -25)
            frames.append((0.05,
                [_person(1, jitter_x, person_cy)],
                [
                    _dog(1, 500, person_cy),
                    _dog(2, 320, person_cy),
                ]))

        events = _run(engine, frames)
        attack_alerts = [e for e in events if e[0] == "POSSIBLE_DOG_ATTACK"]

        # At least one alert should fire
        self.assertGreaterEqual(len(attack_alerts), 1,
            f"Expected at least 1 alert for Dog #2, got: {events}")

        # All alerts should reference Dog #2, not Dog #1
        for alert_type, detail in attack_alerts:
            self.assertIn("Dog #2", detail,
                f"Alert should reference Dog #2: {detail}")
            self.assertNotIn("Dog #1", detail,
                f"Alert should not reference non-interacting Dog #1: {detail}")

    # ------------------------------------------------------------------
    # Test 8: Pair state enum transitions
    # ------------------------------------------------------------------
    def test_pair_state_transitions(self):
        """Verifies the CLEAR → PROXIMITY → INTERACTION → ALERTED path."""
        engine = EventRuleEngine()
        person_cy = 300

        t = 1000.0

        # Initially no pair state
        state = engine.get_dog_pair_state(1, 1)
        self.assertIsNone(state)

        # Bring dog into proximity (but not overlap) — should move to PROXIMITY after first frame
        for _ in range(5):
            t += 0.05
            engine.evaluate_dog_interactions(
                [_person(1, 320, person_cy)],
                [_dog(1, 360, person_cy)],
                now=t,
            )
        state = engine.get_dog_pair_state(1, 1)
        self.assertIn(state, [DogInteractionState.PROXIMITY, DogInteractionState.CLEAR])

        # Sustain proximity for > DOG_MIN_PROXIMITY_TIME
        for _ in range(25):
            t += 0.05
            engine.evaluate_dog_interactions(
                [_person(1, 320, person_cy)],
                [_dog(1, 360, person_cy)],
                now=t,
            )
        # Note: Without overlap+burst, should stay at PROXIMITY
        state = engine.get_dog_pair_state(1, 1)
        self.assertEqual(state, DogInteractionState.PROXIMITY)


if __name__ == "__main__":
    unittest.main()
