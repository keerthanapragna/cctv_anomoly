import sys
from pathlib import Path
import unittest
import numpy as np

# Ensure root directory is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import src.config as cfg
from src.detector import PersonDetection
from src.event_rules import EventRuleEngine, calculate_torso_angle, PersonState


def make_keypoints(torso_angle_deg: float, center_x: float = 300, center_y: float = 300, torso_len: float = 80):
    """
    Constructs a synthetic 17-point COCO keypoint array with the specified torso angle.
    0° = horizontal, 90° = vertical.
    """
    kpts = np.zeros((17, 2), dtype=np.float32)
    confs = np.ones(17, dtype=np.float32)

    rad = np.radians(torso_angle_deg)
    dx = (torso_len / 2.0) * np.cos(rad)
    dy = (torso_len / 2.0) * np.sin(rad)

    # In image coordinates, Y increases downwards.
    # Shoulder is at (center_x - dx, center_y - dy)
    # Hip is at (center_x + dx, center_y + dy)
    kpts[5] = [center_x - dx - 15, center_y - dy]  # Left shoulder
    kpts[6] = [center_x - dx + 15, center_y - dy]  # Right shoulder
    kpts[11] = [center_x + dx - 12, center_y + dy] # Left hip
    kpts[12] = [center_x + dx + 12, center_y + dy] # Right hip

    return kpts, confs


class TestFallDetectionPipeline(unittest.TestCase):
    def setUp(self):
        self.engine = EventRuleEngine(max_inactive_sec=10.0)
        self.frame_height = 480
        self.frame_width = 640

    def test_torso_angle_calculation(self):
        """Verifies calculation of torso angle from keypoints."""
        # 90 degrees (upright)
        kpts_upright, confs = make_keypoints(90.0)
        angle_upright = calculate_torso_angle(kpts_upright, confs)
        self.assertIsNotNone(angle_upright)
        self.assertAlmostEqual(angle_upright, 90.0, delta=2.0)

        # 0 degrees (horizontal)
        kpts_horiz, confs = make_keypoints(0.0)
        angle_horiz = calculate_torso_angle(kpts_horiz, confs)
        self.assertIsNotNone(angle_horiz)
        self.assertAlmostEqual(angle_horiz, 0.0, delta=2.0)

        # 45 degrees
        kpts_45, confs = make_keypoints(45.0)
        angle_45 = calculate_torso_angle(kpts_45, confs)
        self.assertIsNotNone(angle_45)
        self.assertAlmostEqual(angle_45, 45.0, delta=2.0)

    def test_normal_walking_no_alert(self):
        """A person walking upright across frames should never trigger an alert."""
        alerts = []
        t = 1000.0

        for frame_idx in range(30):
            t += 0.05
            center_x = 100 + frame_idx * 5
            center_y = 240
            bbox = np.array([center_x - 30, center_y - 90, center_x + 30, center_y + 90])
            kpts, confs = make_keypoints(85.0, center_x, center_y)

            p = PersonDetection(track_id=1, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            evts = self.engine.evaluate_person(p, self.frame_height, now=t)
            alerts.extend(evts)

        self.assertEqual(len(alerts), 0)
        self.assertEqual(self.engine.tracks[1].state, PersonState.UPRIGHT)

    def test_sitting_down_no_alert(self):
        """Sitting down in a chair: controlled descent with upright torso must NOT trigger fall."""
        alerts = []
        t = 1000.0

        # 1. Standing upright for 10 frames
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 100, 270, 300]) # h=200, w=70
            kpts, confs = make_keypoints(85.0, 235, 200)
            p = PersonDetection(track_id=2, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 2. Controlled descent to chair over 1.5s
        for step in range(25):
            t += 0.06
            y1 = 100 + step * 4
            y2 = 300 + step * 2
            bbox = np.array([190, y1, 280, y2])
            # Torso stays upright (~75°)
            kpts, confs = make_keypoints(75.0, 235, (y1 + y2) / 2)
            p = PersonDetection(track_id=2, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 3. Remains sitting for 2.0s
        for _ in range(30):
            t += 0.06
            bbox = np.array([190, 200, 285, 350]) # h=150, w=95, aspect=0.63
            kpts, confs = make_keypoints(75.0, 235, 275)
            p = PersonDetection(track_id=2, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        self.assertEqual(len(alerts), 0, f"False positive triggered during sitting: {alerts}")

    def test_bending_down_no_alert(self):
        """Bending down to tie shoes and recovering must NOT trigger fall."""
        alerts = []
        t = 1000.0

        # Standing
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 120, 270, 320])
            kpts, confs = make_keypoints(85.0, 235, 220)
            p = PersonDetection(track_id=3, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # Bends forward (torso tilts to 30 deg, but person stands upright again after 0.8s)
        for step in range(12):
            t += 0.06
            bbox = np.array([200, 180, 290, 320])
            kpts, confs = make_keypoints(30.0, 245, 250)
            p = PersonDetection(track_id=3, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # Recovers back to standing
        for _ in range(15):
            t += 0.06
            bbox = np.array([200, 120, 270, 320])
            kpts, confs = make_keypoints(85.0, 235, 220)
            p = PersonDetection(track_id=3, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        self.assertEqual(len(alerts), 0, f"False positive triggered during bending: {alerts}")

    def test_kneeling_down_no_alert(self):
        """Kneeling: vertical descent with upright torso must NOT trigger fall."""
        alerts = []
        t = 1000.0

        # Standing
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 100, 260, 300])
            kpts, confs = make_keypoints(85.0, 230, 200)
            p = PersonDetection(track_id=4, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # Kneeling: descends but torso angle stays 80°
        for _ in range(25):
            t += 0.06
            bbox = np.array([200, 200, 280, 340]) # h=140, w=80
            kpts, confs = make_keypoints(80.0, 240, 270)
            p = PersonDetection(track_id=4, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        self.assertEqual(len(alerts), 0, f"False positive triggered during kneeling: {alerts}")

    def test_slow_lying_down_no_alert(self):
        """Gradually lying down without sudden descent velocity must NOT trigger fall."""
        alerts = []
        t = 1000.0

        # Standing
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 100, 270, 300])
            kpts, confs = make_keypoints(85.0, 235, 200)
            p = PersonDetection(track_id=5, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # Gradually lying down over 4.0 seconds (very low descent velocity)
        for step in range(50):
            t += 0.08
            frac = step / 50.0
            y1 = 100 + frac * 250
            y2 = 300 + frac * 100
            angle = 85.0 - frac * 75.0
            bbox = np.array([200 - frac * 50, y1, 270 + frac * 80, y2])
            kpts, confs = make_keypoints(angle, 250, (y1 + y2) / 2)
            p = PersonDetection(track_id=5, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        self.assertEqual(len(alerts), 0, f"False positive triggered during gradual lying down: {alerts}")

    def test_sudden_fall_with_sustained_ground_triggers_alert(self):
        """A sudden collapse followed by lying motionless on ground MUST trigger POSSIBLE_FALL."""
        alerts = []
        t = 1000.0

        # 1. Standing upright baseline (10 frames)
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 80, 270, 280]) # center_y = 180
            kpts, confs = make_keypoints(85.0, 235, 180)
            p = PersonDetection(track_id=6, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 2. Sudden rapid descent (in 0.25s, center_y drops from 180 to 360, dy=180px, vel > 0.35H/s)
        for i in range(5):
            t += 0.05
            center_y = 180 + (i + 1) * 36
            bbox = np.array([180, center_y - 40, 320, center_y + 40])
            angle = 85.0 - (i + 1) * 15.0
            kpts, confs = make_keypoints(angle, 250, center_y)
            p = PersonDetection(track_id=6, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 3. Lands on ground in horizontal posture: angle=15°, wide bbox
        ground_bbox = np.array([160, 350, 360, 420]) # w=200, h=70, aspect=2.85
        ground_kpts, ground_confs = make_keypoints(15.0, 260, 385)

        # Remains motionless on ground for 2.0s (> FALL_GROUND_TIME=1.5s)
        for _ in range(40):
            t += 0.05
            p = PersonDetection(track_id=6, bbox=ground_bbox, keypoints=ground_kpts, keypoint_conf=ground_confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # Check that POSSIBLE_FALL was triggered
        fall_alerts = [evt for evt in alerts if evt[0] == "POSSIBLE_FALL"]
        self.assertEqual(len(fall_alerts), 1, f"Expected 1 fall alert, got {len(fall_alerts)}: {alerts}")
        self.assertIn("Track #6", fall_alerts[0][1])
        self.assertIn("Human verification required", fall_alerts[0][1])

    def test_trip_with_quick_recovery_no_alert(self):
        """Sudden trip where person stands right back up before ground duration MUST NOT alert."""
        alerts = []
        t = 1000.0

        # 1. Standing upright baseline
        for _ in range(10):
            t += 0.05
            bbox = np.array([200, 80, 270, 280])
            kpts, confs = make_keypoints(85.0, 235, 180)
            p = PersonDetection(track_id=7, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 2. Sudden trip / drop
        for i in range(5):
            t += 0.05
            center_y = 180 + (i + 1) * 36
            bbox = np.array([180, center_y - 40, 320, center_y + 40])
            kpts, confs = make_keypoints(25.0, 250, center_y)
            p = PersonDetection(track_id=7, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 3. Only on ground for 0.4s (< 1.5s ground threshold)
        for _ in range(8):
            t += 0.05
            bbox = np.array([160, 350, 360, 420])
            kpts, confs = make_keypoints(15.0, 260, 385)
            p = PersonDetection(track_id=7, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        # 4. Stands right back up
        for _ in range(20):
            t += 0.05
            bbox = np.array([200, 80, 270, 280])
            kpts, confs = make_keypoints(85.0, 235, 180)
            p = PersonDetection(track_id=7, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            alerts.extend(self.engine.evaluate_person(p, self.frame_height, now=t))

        fall_alerts = [evt for evt in alerts if evt[0] == "POSSIBLE_FALL"]
        self.assertEqual(len(fall_alerts), 0, f"Expected no alert for quick recovery, got {fall_alerts}")


if __name__ == "__main__":
    unittest.main()
