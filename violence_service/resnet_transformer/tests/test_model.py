import os
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import cv2
import numpy as np
import torch
from configs.config import FRAME_SIZE, NUM_FRAMES
from models.model import HybridVideoClassifier
from src.load_model import load_trained_model, resolve_model_path
from src.video_utils import load_video_frames


class TestViolenceDetectionModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Resolve checkpoint and load model once for test suite
        cls.ckpt_path = resolve_model_path("hybrid_model3.pth")
        cls.model, cls.device = load_trained_model(cls.ckpt_path)

    def test_checkpoint_exists(self):
        """Verify that the pretrained checkpoint exists and is non-empty."""
        self.assertTrue(os.path.isfile(self.ckpt_path), f"Checkpoint missing at {self.ckpt_path}")
        file_size = os.path.getsize(self.ckpt_path)
        self.assertGreater(file_size, 100 * 1024 * 1024, "Checkpoint file is smaller than expected 100MB")

    def test_model_loaded_and_eval_mode(self):
        """Verify model instance and evaluation mode."""
        self.assertIsInstance(self.model, HybridVideoClassifier)
        self.assertFalse(self.model.training, "Model should be in evaluation mode (model.eval())")

    def test_dummy_inference_single_batch(self):
        """Verify forward pass on dummy input [1, NUM_FRAMES, 3, H, W]."""
        batch_size = 1
        h, w = FRAME_SIZE[1], FRAME_SIZE[0]
        dummy_tensor = torch.randn(batch_size, NUM_FRAMES, 3, h, w, device=self.device)

        with torch.no_grad():
            logits, uncertainty = self.model(dummy_tensor)

        # Verify logits
        self.assertEqual(logits.shape, torch.Size([batch_size]))
        self.assertTrue(torch.isfinite(logits).all(), "Logits contain non-finite values")

        # Verify uncertainty head
        self.assertEqual(uncertainty.shape, torch.Size([batch_size]))
        self.assertTrue(torch.isfinite(uncertainty).all(), "Uncertainty contains non-finite values")
        self.assertTrue((uncertainty >= 0.0).all() and (uncertainty <= 1.0).all(), "Uncertainty must be in [0, 1]")

        # Verify sigmoid probability
        prob = torch.sigmoid(logits).item()
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

    def test_dummy_inference_multi_batch(self):
        """Verify forward pass supports multi-batch [B, NUM_FRAMES, 3, H, W]."""
        batch_size = 2
        h, w = FRAME_SIZE[1], FRAME_SIZE[0]
        dummy_tensor = torch.randn(batch_size, NUM_FRAMES, 3, h, w, device=self.device)

        with torch.no_grad():
            logits, uncertainty = self.model(dummy_tensor)

        self.assertEqual(logits.shape, torch.Size([batch_size]))
        self.assertEqual(uncertainty.shape, torch.Size([batch_size]))

    def test_video_utils_synthetic_video(self):
        """Verify load_video_frames on a valid synthetic video file."""
        h, w = FRAME_SIZE[1], FRAME_SIZE[0]
        temp_dir = tempfile.mkdtemp()
        temp_video = os.path.join(temp_dir, "synthetic_test.mp4")

        try:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(temp_video, fourcc, 10.0, (w, h))
            for i in range(10):
                frame = np.full((h, w, 3), fill_value=(i * 20) % 256, dtype=np.uint8)
                out.write(frame)
            out.release()

            frames_tensor = load_video_frames(temp_video, num_frames=NUM_FRAMES, resize=FRAME_SIZE)
            expected_shape = torch.Size([NUM_FRAMES, 3, h, w])
            self.assertEqual(frames_tensor.shape, expected_shape)
            self.assertEqual(frames_tensor.dtype, torch.float32)

            # Test feeding into model after unsqueeze(0)
            batched_input = frames_tensor.unsqueeze(0).to(self.device)
            with torch.no_grad():
                logits, uncertainty = self.model(batched_input)
            self.assertEqual(logits.shape, torch.Size([1]))
            self.assertEqual(uncertainty.shape, torch.Size([1]))

        finally:
            if os.path.exists(temp_video):
                try:
                    os.remove(temp_video)
                except Exception:
                    pass
            if os.path.exists(temp_dir):
                try:
                    os.rmdir(temp_dir)
                except Exception:
                    pass

    def test_video_utils_invalid_and_empty_inputs(self):
        """Verify load_video_frames handles missing or 0-byte video files gracefully."""
        h, w = FRAME_SIZE[1], FRAME_SIZE[0]
        expected_shape = torch.Size([NUM_FRAMES, 3, h, w])

        # Test non-existent file
        tensor_none = load_video_frames(None)
        self.assertEqual(tensor_none.shape, expected_shape)

        tensor_missing = load_video_frames("non_existent_file_xyz.mp4")
        self.assertEqual(tensor_missing.shape, expected_shape)

        # Test empty (0 bytes) file
        temp_empty = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        temp_empty.close()
        try:
            tensor_empty = load_video_frames(temp_empty.name)
            self.assertEqual(tensor_empty.shape, expected_shape)
        finally:
            try:
                os.remove(temp_empty.name)
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
