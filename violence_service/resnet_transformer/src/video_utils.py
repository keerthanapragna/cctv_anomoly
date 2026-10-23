import os
import cv2
import numpy as np
import torch
from configs.config import NUM_FRAMES, FRAME_SIZE, IMAGENET_MEAN, IMAGENET_STD


def load_video_frames(video_path, num_frames=NUM_FRAMES, resize=FRAME_SIZE):
    """
    Extracts and normalizes frames from a video file.

    Returns:
        torch.Tensor of shape [num_frames, 3, height, width] with dtype torch.float32.
        When unsqueezed at dim 0, produces [1, num_frames, 3, height, width]
        as expected by HybridVideoClassifier.
    """
    h, w = resize[1], resize[0]
    fallback_frame = np.zeros((h, w, 3), dtype=np.uint8)

    if not video_path or not os.path.isfile(video_path):
        print(f"Warning: Video file does not exist or invalid path: {video_path}")
        return torch.zeros((num_frames, 3, h, w), dtype=torch.float32)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"Warning: Cannot open video: {video_path}")
        return torch.zeros((num_frames, 3, h, w), dtype=torch.float32)

    frames = []
    last_valid_frame = fallback_frame

    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if total_frames <= 0:
            # Check if at least one frame is readable
            ret, test_frame = cap.read()
            if not ret or test_frame is None:
                print(f"Warning: Video contains no readable frames: {video_path}")
                return torch.zeros((num_frames, 3, h, w), dtype=torch.float32)
            # Reset back to beginning
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            frame_idxs = [0] * num_frames
        else:
            frame_idxs = np.linspace(0, max(total_frames - 1, 0), num_frames).astype(int)

        mean = np.array(IMAGENET_MEAN, dtype=np.float32)
        std = np.array(IMAGENET_STD, dtype=np.float32)

        for idx in frame_idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()

            if not ret or frame is None:
                frame = last_valid_frame
            else:
                try:
                    if frame.ndim == 2:
                        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
                    elif frame.shape[2] == 4:
                        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
                    elif frame.shape[2] == 3:
                        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    else:
                        frame = last_valid_frame
                    frame = cv2.resize(frame, (w, h))
                    last_valid_frame = frame
                except Exception:
                    frame = last_valid_frame

            # Normalize using ImageNet statistics: [0, 1] then standardize
            frame_norm = frame.astype(np.float32) / 255.0
            frame_norm = (frame_norm - mean) / std
            # Transpose from (H, W, C) to (C, H, W)
            frame_transposed = np.transpose(frame_norm, (2, 0, 1))
            frames.append(frame_transposed)

    except Exception as e:
        print(f"Warning: Error processing video frames: {e}")
        # Pad with fallback if partially read
        mean = np.array(IMAGENET_MEAN, dtype=np.float32)
        std = np.array(IMAGENET_STD, dtype=np.float32)
        fallback_norm = np.transpose((fallback_frame.astype(np.float32) / 255.0 - mean) / std, (2, 0, 1))
        while len(frames) < num_frames:
            frames.append(fallback_norm)
    finally:
        cap.release()

    if len(frames) == 0:
        return torch.zeros((num_frames, 3, h, w), dtype=torch.float32)

    frames_array = np.stack(frames[:num_frames], axis=0)
    return torch.from_numpy(np.ascontiguousarray(frames_array, dtype=np.float32))


