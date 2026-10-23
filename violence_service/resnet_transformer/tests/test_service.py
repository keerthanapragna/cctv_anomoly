import os
import sys
import unittest
import asyncio
import base64
import numpy as np
import cv2
from pathlib import Path

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from service import (
    app,
    state,
    evaluate_severity_policy,
    preprocess_numpy_frames,
    health_check,
    get_service_config,
    analyze_frame_sequence,
    FramesInferenceRequest,
)
from src.load_model import load_trained_model, resolve_model_path


class TestServiceDirect(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Load model for testing once
        ckpt = resolve_model_path("hybrid_model3.pth")
        model, device = load_trained_model(ckpt, device="cpu")
        state["model"] = model
        state["device"] = device
        state["checkpoint_path"] = ckpt
        state["loaded_at"] = 1000.0

    def test_health_check(self):
        res = health_check()
        self.assertEqual(res["status"], "healthy")
        self.assertEqual(res["frames_sampled"], 16)
        self.assertEqual(res["device"], "cpu")

    def test_get_service_config(self):
        res = get_service_config()
        self.assertEqual(res["default_threshold"], 0.65)
        self.assertEqual(res["num_frames"], 16)
        self.assertIn("No apparent violence detected", res["severity_categories"])

    def test_severity_policy_logic(self):
        # Non-violence, low uncertainty
        p1 = evaluate_severity_policy(prob=0.10, uncertainty=0.15, threshold=0.65)
        self.assertFalse(p1["is_violent"])
        self.assertFalse(p1["qualifies_as_incident"])
        self.assertEqual(p1["severity"], "No apparent violence detected")

        # Below threshold, elevated uncertainty -> review required, does not qualify as confirmed alert
        p2 = evaluate_severity_policy(prob=0.50, uncertainty=0.45, threshold=0.65)
        self.assertFalse(p2["is_violent"])
        self.assertFalse(p2["qualifies_as_incident"])
        self.assertTrue(p2["requires_human_review"])

        # Above threshold, moderate probability
        p3 = evaluate_severity_policy(prob=0.75, uncertainty=0.20, threshold=0.65)
        self.assertTrue(p3["is_violent"])
        self.assertTrue(p3["qualifies_as_incident"])
        self.assertEqual(p3["priority"], "High")

        # Critical probability (>= 0.85) with low uncertainty
        p4 = evaluate_severity_policy(prob=0.92, uncertainty=0.18, threshold=0.65)
        self.assertTrue(p4["is_violent"])
        self.assertTrue(p4["qualifies_as_incident"])
        self.assertEqual(p4["priority"], "Critical")
        self.assertIn("Severe", p4["severity"])

    def test_analyze_frames_direct(self):
        # Generate 16 synthetic JPEG frames as base64 strings
        frames_b64 = []
        for i in range(16):
            img = np.full((224, 224, 3), fill_value=(i * 15) % 256, dtype=np.uint8)
            _, buf = cv2.imencode(".jpg", img)
            b64_str = base64.b64encode(buf).decode("utf-8")
            frames_b64.append(f"data:image/jpeg;base64,{b64_str}")

        req = FramesInferenceRequest(
            frames=frames_b64,
            threshold=0.65,
            camera_id="CAM-WEBCAM-TEST",
            source="webcam",
        )

        res = asyncio.run(analyze_frame_sequence(req))
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["camera_id"], "CAM-WEBCAM-TEST")
        self.assertEqual(res["source"], "webcam")
        self.assertEqual(res["frames_analyzed"], 16)
        self.assertIn("violence_prob", res)
        self.assertIn("uncertainty_score", res)
        self.assertIn("severity_assessment", res)
        self.assertIn("response_priority", res)
        self.assertIn("requires_human_review", res)
        self.assertIn("qualifies_as_incident", res)
        self.assertIn("processing_time_ms", res)
        self.assertGreater(res["processing_time_ms"], 0)


if __name__ == "__main__":
    unittest.main()
