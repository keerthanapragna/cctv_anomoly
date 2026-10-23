"""
FastAPI Inference Service for Video & Live Camera Violence Detection.
Integrates Hybrid 3D-ResNet18 + Transformer model with campus safety backend.
Supports video file uploads, live frame sequences (webcam), and server-side CCTV streams.
"""

import os
import sys
import time
import base64
import tempfile
import logging
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

# Add parent directory of service so local modules are importable
SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import cv2
import numpy as np
import requests
import torch
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from configs.config import NUM_FRAMES, FRAME_SIZE, IMAGENET_MEAN, IMAGENET_STD
from src.load_model import load_trained_model, resolve_model_path
from src.video_utils import load_video_frames

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ViolenceInferenceService")

# Global model state
state = {
    "model": None,
    "device": None,
    "checkpoint_path": None,
    "loaded_at": None,
}

# Max allowed video upload size: 100 MB
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

# CCTV Background Worker State
cctv_worker_state = {
    "thread": None,
    "stop_event": threading.Event(),
    "is_running": False,
    "stream_url": None,
    "camera_id": "CAM-CCTV-01",
    "status": "idle",  # idle, connecting, streaming, error, stopped
    "last_error": None,
    "last_inference_time": None,
    "last_result": None,
    "frames_processed": 0,
    "lock": threading.Lock(),
}


def evaluate_severity_policy(
    prob: float,
    uncertainty: float,
    threshold: float
) -> dict:
    """
    Experimental Campus Safety Assessment Policy.
    Maps raw model outputs (violence probability and uncertainty) into
    operational severity tiers and response priorities.

    IMPORTANT: The pretrained model outputs only a binary violence logit
    and an uncertainty score. These severity categories are an application-level
    operational policy for human triage and do NOT claim the model was trained
    on fine-grained severity classes.
    """
    is_violent = prob >= threshold
    near_threshold = abs(prob - threshold) <= 0.08
    high_uncertainty = uncertainty >= 0.40

    # Human review flag
    requires_human_review = high_uncertainty or near_threshold

    if not is_violent:
        if prob < min(threshold, 0.35) and not high_uncertainty:
            severity = "No apparent violence detected"
            priority = "None"
            qualifies = False
            reason = (
                f"Model violence probability ({prob:.2%}) is well below decision threshold ({threshold:.2f}) "
                f"with acceptable confidence (uncertainty {uncertainty:.2f}). No safety incident required."
            )
        else:
            severity = "Slight or suspected violence"
            priority = "Low"
            qualifies = False
            if high_uncertainty:
                reason = (
                    f"Probability ({prob:.2%}) is below threshold ({threshold:.2f}), but model uncertainty is elevated "
                    f"({uncertainty:.2f} >= 0.40). Recommended for routine safety audit."
                )
            else:
                reason = (
                    f"Minor visual agitation or activity detected (probability {prob:.2%}), below dispatch threshold ({threshold:.2f})."
                )
    else:
        # High confidence violence (prob >= 85% and uncertainty < 40%)
        if prob >= 0.85 and not high_uncertainty:
            severity = "Severe or critical suspected violence"
            priority = "Critical"
            qualifies = True
            reason = (
                f"High-confidence violence detection ({prob:.2%} >= 85%) with low model uncertainty ({uncertainty:.2f}). "
                f"Immediate emergency security response required."
            )
        else:
            severity = "Moderate suspected violence"
            priority = "High"
            qualifies = True
            if high_uncertainty:
                reason = (
                    f"Model exceeded detection threshold ({prob:.2%} >= {threshold:.2f}), but uncertainty is notable "
                    f"({uncertainty:.2f}). Designated High priority with mandatory human officer verification."
                )
            else:
                reason = (
                    f"Probable physical altercation detected ({prob:.2%} >= {threshold:.2f}) with solid confidence "
                    f"(uncertainty {uncertainty:.2f}). Rapid dispatch warranted."
                )

    return {
        "is_violent": is_violent,
        "severity": severity,
        "priority": priority,
        "requires_human_review": requires_human_review,
        "qualifies_as_incident": qualifies,
        "reason": reason,
    }


def preprocess_numpy_frames(frames: List[np.ndarray], target_size=FRAME_SIZE, num_frames=NUM_FRAMES) -> torch.Tensor:
    """
    Takes a list of RGB/BGR numpy frames, resizes to target_size, normalizes using ImageNet mean/std,
    and returns a torch.Tensor of shape [num_frames, 3, H, W] suitable for HybridVideoClassifier.
    """
    if not frames:
        raise ValueError("Frames list is empty")

    h, w = target_size[1], target_size[0]
    processed = []

    mean = np.array(IMAGENET_MEAN, dtype=np.float32)
    std = np.array(IMAGENET_STD, dtype=np.float32)

    # Sample exactly num_frames
    if len(frames) == num_frames:
        sampled_frames = frames
    elif len(frames) < num_frames:
        # Interpolate / duplicate frames evenly to reach num_frames
        indices = np.linspace(0, len(frames) - 1, num_frames).astype(int)
        sampled_frames = [frames[i] for i in indices]
    else:
        # Sample num_frames uniformly
        indices = np.linspace(0, len(frames) - 1, num_frames).astype(int)
        sampled_frames = [frames[i] for i in indices]

    for frame in sampled_frames:
        if frame is None or frame.size == 0:
            frame = np.zeros((h, w, 3), dtype=np.uint8)
        else:
            if frame.ndim == 2:
                frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
            elif frame.shape[2] == 4:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
            elif frame.shape[2] == 3:
                # If frame is already RGB or BGR, ensure standard 3-channel
                pass

            if (frame.shape[1], frame.shape[0]) != (w, h):
                frame = cv2.resize(frame, (w, h))

        # Normalize with ImageNet mean and std
        norm = frame.astype(np.float32) / 255.0
        norm = (norm - mean) / std
        transposed = np.transpose(norm, (2, 0, 1))  # (3, H, W)
        processed.append(transposed)

    frames_array = np.stack(processed[:num_frames], axis=0)
    return torch.from_numpy(np.ascontiguousarray(frames_array, dtype=np.float32))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load pretrained model into memory once on CPU
    logger.info("Initializing Violence Detection Model...")
    try:
        ckpt = resolve_model_path("hybrid_model3.pth")
        model, device = load_trained_model(ckpt, device="cpu")
        state["model"] = model
        state["device"] = device
        state["checkpoint_path"] = ckpt
        state["loaded_at"] = time.time()
        logger.info("Violence Detection Model loaded successfully on %s (checkpoint: %s)", device, ckpt)
    except Exception as e:
        logger.error("Failed to load violence detection model: %s", e, exc_info=True)
        raise

    yield

    # Shutdown: Stop CCTV worker if running
    if cctv_worker_state["is_running"]:
        cctv_worker_state["stop_event"].set()
        if cctv_worker_state["thread"]:
            cctv_worker_state["thread"].join(timeout=3)
    state["model"] = None
    logger.info("Violence Detection Service shut down.")


app = FastAPI(
    title="Campus Safety Violence Detection Inference Service",
    description="ResNet3D + Temporal Transformer video classifier with dual heads (violence logits & uncertainty).",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Schemas
class FramesInferenceRequest(BaseModel):
    frames: List[str] = Field(..., description="Array of base64-encoded JPEG image strings (up to 16 frames)")
    threshold: Optional[float] = Field(0.65, ge=0.01, le=0.99, description="Decision threshold")
    camera_id: Optional[str] = Field("CAM-WEBCAM", description="Camera or source identifier")
    source: Optional[str] = Field("webcam", description="Source type: webcam, cctv, recorded_file")


class CctvStartRequest(BaseModel):
    stream_url: Optional[str] = Field(None, description="Authorised CCTV RTSP/HTTP stream URL")
    camera_id: Optional[str] = Field("CAM-CCTV-01", description="Camera identifier")
    sample_interval: Optional[float] = Field(4.0, ge=1.0, le=30.0, description="Inference interval in seconds")
    threshold: Optional[float] = Field(0.65, ge=0.01, le=0.99, description="Decision threshold")
    backend_ingest_url: Optional[str] = Field(None, description="Express backend ingest URL")
    ingest_api_key: Optional[str] = Field(None, description="Backend ingestion API key")


@app.get("/health")
def health_check():
    """Health status and model readiness check."""
    ready = state["model"] is not None
    return {
        "status": "healthy" if ready else "initializing",
        "service": "violence-detection-service",
        "device": str(state.get("device")),
        "checkpoint": os.path.basename(state.get("checkpoint_path", "")),
        "model_architecture": "HybridVideoClassifier (r3d_18 + TransformerEncoder)",
        "frames_sampled": NUM_FRAMES,
        "frame_dimensions": list(FRAME_SIZE),
        "uptime_seconds": round(time.time() - state["loaded_at"], 1) if state["loaded_at"] else 0,
        "cctv_streaming": cctv_worker_state["is_running"],
    }


@app.get("/config")
def get_service_config():
    """Return configured model parameters and operational policy settings."""
    return {
        "default_threshold": 0.65,
        "num_frames": NUM_FRAMES,
        "frame_size": list(FRAME_SIZE),
        "allowed_extensions": sorted(list(ALLOWED_EXTENSIONS)),
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "severity_categories": [
            "No apparent violence detected",
            "Slight or suspected violence",
            "Moderate suspected violence",
            "Severe or critical suspected violence",
        ],
        "response_priorities": ["None", "Low", "Medium", "High", "Critical"],
        "policy_status": "Experimental heuristic - subject to campus validation dataset",
    }


@app.post("/analyze")
async def analyze_video(
    file: UploadFile = File(..., description="Video file to analyze"),
    threshold: float = Query(0.65, ge=0.01, le=0.99, description="Decision threshold for violence classification"),
):
    """
    Process an uploaded video file through the pretrained ResNet-18 + Transformer pipeline.
    Returns model logits, violence probability, uncertainty score, and triage policy assessment.
    """
    if state["model"] is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not initialized or still loading."
        )

    filename = file.filename or "uploaded_video.mp4"
    file_ext = Path(filename).suffix.lower()

    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported video format '{file_ext}'. Supported formats: {sorted(list(ALLOWED_EXTENSIONS))}"
        )

    # Save uploaded stream to temporary file safely
    start_time = time.time()
    temp_fd, temp_path = tempfile.mkstemp(suffix=file_ext or ".mp4")
    os.close(temp_fd)

    total_bytes = 0
    try:
        with open(temp_path, "wb") as f_out:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Video file exceeds maximum size limit of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                    )
                f_out.write(chunk)

        if total_bytes == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded video file is empty (0 bytes)."
            )

        # Extract frames with robust video utils
        video_tensor = load_video_frames(temp_path, num_frames=NUM_FRAMES, resize=FRAME_SIZE)

        # Check if any frames were actually decodable
        if video_tensor.abs().sum() == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unable to decode video stream. The file may be corrupt, truncated, or encoded in an unsupported codec."
            )

        # Add batch dimension [1, NUM_FRAMES, 3, H, W]
        batched_tensor = video_tensor.unsqueeze(0).to(state["device"])

        # Forward pass on CPU
        model = state["model"]
        with torch.no_grad():
            logits_tensor, uncertainty_tensor = model(batched_tensor)
            logits = float(logits_tensor.item())
            prob = float(torch.sigmoid(logits_tensor).item())
            uncertainty = float(uncertainty_tensor.item())

        proc_time = round((time.time() - start_time) * 1000, 1)

        # Apply triage policy
        policy = evaluate_severity_policy(prob, uncertainty, threshold)

        logger.info(
            "[DEV_LOG][VIDEO_INFERENCE] filename=%s size_bytes=%d "
            "raw_logit=%.4f prob=%.4f (%.1f%%) uncertainty=%.4f threshold=%.2f qualifies=%s severity='%s' priority='%s' latency_ms=%.1f reason='%s'",
            filename,
            total_bytes,
            logits,
            prob,
            prob * 100,
            uncertainty,
            threshold,
            policy["qualifies_as_incident"],
            policy["severity"],
            policy["priority"],
            proc_time,
            policy["reason"],
        )

        return {
            "status": "success",
            "filename": filename,
            "source": "uploaded_video",
            "file_size_bytes": total_bytes,
            "threshold": threshold,
            "raw_logit": round(logits, 4),
            "violence_prob": round(prob, 4),
            "non_violence_prob": round(1.0 - prob, 4),
            "uncertainty_score": round(uncertainty, 4),
            "preliminary_result": "violent" if policy["is_violent"] else "non_violent",
            "severity_assessment": policy["severity"],
            "response_priority": policy["priority"],
            "requires_human_review": policy["requires_human_review"],
            "qualifies_as_incident": policy["qualifies_as_incident"],
            "policy_explanation": policy["reason"],
            "processing_time_ms": proc_time,
        }

    finally:
        # Guarantee removal of temp video from disk
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                logger.warning("Failed to clean up temp file %s: %s", temp_path, e)


@app.post("/analyze-frames")
async def analyze_frame_sequence(req: FramesInferenceRequest):
    """
    Process a temporal sequence of base64 JPEG frames (from browser webcam or live sampler).
    Decodes, standardizes to [1, 16, 3, 224, 224], and runs CPU inference with uncertainty scoring.
    """
    if state["model"] is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not initialized or still loading."
        )

    if not req.frames or len(req.frames) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 1 frame is required in the frames array."
        )

    start_time = time.time()
    decoded_frames = []

    for idx, frame_str in enumerate(req.frames):
        try:
            # Handle possible data URL prefix (e.g., 'data:image/jpeg;base64,...')
            if "," in frame_str:
                frame_data = frame_str.split(",", 1)[1]
            else:
                frame_data = frame_str

            img_bytes = base64.b64decode(frame_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is not None and img.size > 0:
                # Convert BGR to RGB
                rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                decoded_frames.append(rgb_img)
        except Exception as e:
            logger.debug("Failed to decode frame at index %d: %s", idx, e)

    if len(decoded_frames) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No decodable frames found in payload. Ensure images are valid base64-encoded JPEG/PNG."
        )

    try:
        # Preprocess and normalize frames
        frames_tensor = preprocess_numpy_frames(decoded_frames, target_size=FRAME_SIZE, num_frames=NUM_FRAMES)
        batched_tensor = frames_tensor.unsqueeze(0).to(state["device"])

        # Forward pass on CPU
        model = state["model"]
        with torch.no_grad():
            logits_tensor, uncertainty_tensor = model(batched_tensor)
            logits = float(logits_tensor.item())
            prob = float(torch.sigmoid(logits_tensor).item())
            uncertainty = float(uncertainty_tensor.item())

        proc_time = round((time.time() - start_time) * 1000, 1)

        # Apply triage policy
        threshold = req.threshold or 0.65
        policy = evaluate_severity_policy(prob, uncertainty, threshold)

        logger.info(
            "[DEV_LOG][FRAME_INFERENCE] camera_id=%s source=%s frames_received=%d frames_analyzed=%d "
            "raw_logit=%.4f prob=%.4f (%.1f%%) uncertainty=%.4f threshold=%.2f qualifies=%s severity='%s' priority='%s' latency_ms=%.1f reason='%s'",
            req.camera_id,
            req.source,
            len(req.frames),
            NUM_FRAMES,
            logits,
            prob,
            prob * 100,
            uncertainty,
            threshold,
            policy["qualifies_as_incident"],
            policy["severity"],
            policy["priority"],
            proc_time,
            policy["reason"],
        )

        return {
            "status": "success",
            "camera_id": req.camera_id,
            "source": req.source,
            "frames_analyzed": NUM_FRAMES,
            "frames_received": len(req.frames),
            "threshold": threshold,
            "raw_logit": round(logits, 4),
            "violence_prob": round(prob, 4),
            "non_violence_prob": round(1.0 - prob, 4),
            "uncertainty_score": round(uncertainty, 4),
            "preliminary_result": "violent" if policy["is_violent"] else "non_violent",
            "severity_assessment": policy["severity"],
            "response_priority": policy["priority"],
            "requires_human_review": policy["requires_human_review"],
            "qualifies_as_incident": policy["qualifies_as_incident"],
            "policy_explanation": policy["reason"],
            "processing_time_ms": proc_time,
        }

    except Exception as e:
        logger.error("Error during frame sequence inference: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference processing failed: {str(e)}"
        )


# CCTV Background Thread Worker
def _cctv_monitor_loop(
    stream_url: str,
    camera_id: str,
    sample_interval: float,
    threshold: float,
    backend_url: Optional[str],
    ingest_key: Optional[str],
    stop_event: threading.Event,
):
    """
    Background worker thread that samples short clips from an authorized RTSP/CCTV stream
    and executes inference at controlled intervals. Never logs sensitive credentials.
    """
    logger.info("Starting CCTV monitor worker for camera %s (interval=%.1fs)", camera_id, sample_interval)
    cctv_worker_state["status"] = "connecting"

    cap = None
    try:
        cap = cv2.VideoCapture(stream_url)
        if not cap.isOpened():
            raise ConnectionError(f"Cannot open camera stream at designated address.")

        cctv_worker_state["status"] = "streaming"
        cctv_worker_state["last_error"] = None

        while not stop_event.is_set():
            clip_frames = []
            clip_start = time.time()

            # Collect 16 frames over a ~1.5 - 2s window
            while len(clip_frames) < NUM_FRAMES and not stop_event.is_set():
                ret, frame = cap.read()
                if not ret or frame is None:
                    # Stream interrupted
                    cctv_worker_state["status"] = "reconnecting"
                    time.sleep(1.0)
                    cap.release()
                    cap = cv2.VideoCapture(stream_url)
                    if not cap.isOpened():
                        raise ConnectionError("Lost connection to CCTV stream; reconnect failed.")
                    continue

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                clip_frames.append(rgb)
                time.sleep(0.08)  # ~12 fps sampling rate for 16 frames = ~1.3s window

            if stop_event.is_set() or len(clip_frames) < NUM_FRAMES:
                break

            # Run inference
            try:
                frames_tensor = preprocess_numpy_frames(clip_frames, target_size=FRAME_SIZE, num_frames=NUM_FRAMES)
                batched = frames_tensor.unsqueeze(0).to(state["device"])

                model = state["model"]
                if model:
                    with torch.no_grad():
                        logits_tensor, uncertainty_tensor = model(batched)
                        logits = float(logits_tensor.item())
                        prob = float(torch.sigmoid(logits_tensor).item())
                        uncertainty = float(uncertainty_tensor.item())

                    policy = evaluate_severity_policy(prob, uncertainty, threshold)
                    cctv_worker_state["frames_processed"] += len(clip_frames)
                    cctv_worker_state["last_inference_time"] = time.time()
                    cctv_worker_state["last_result"] = {
                        "violence_prob": round(prob, 4),
                        "uncertainty_score": round(uncertainty, 4),
                        "severity": policy["severity"],
                        "qualifies": policy["qualifies_as_incident"],
                        "timestamp": time.time(),
                    }

                    # If qualifying alert and backend URL provided, send alert
                    if policy["qualifies_as_incident"] and backend_url and ingest_key:
                        try:
                            payload = {
                                "category": "Fight detection",
                                "confidence": prob,
                                "cameraId": camera_id,
                                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "details": f"Live CCTV Alert: {policy['severity']} on {camera_id} (conf: {prob:.2%}, unc: {uncertainty:.2f})",
                                "metadata": {
                                    "source": "cctv",
                                    "violence_score": prob,
                                    "uncertainty": uncertainty,
                                    "threshold": threshold,
                                    "severity": policy["severity"],
                                    "requires_human_review": policy["requires_human_review"],
                                },
                            }
                            requests.post(
                                f"{backend_url.rstrip('/')}/api/v1/violence/ingest",
                                json=payload,
                                headers={"x-ingest-api-key": ingest_key},
                                timeout=4.0,
                            )
                        except Exception as post_err:
                            logger.warning("Failed to forward CCTV alert to backend: %s", post_err)

            except Exception as inf_err:
                logger.error("CCTV inference error: %s", inf_err)
                cctv_worker_state["last_error"] = str(inf_err)

            # Wait for next sample interval minus clip capture time
            elapsed = time.time() - clip_start
            sleep_time = max(0.5, sample_interval - elapsed)
            stop_event.wait(sleep_time)

    except Exception as e:
        logger.error("CCTV worker error: %s", e)
        cctv_worker_state["status"] = "error"
        cctv_worker_state["last_error"] = str(e)
    finally:
        if cap:
            cap.release()
        cctv_worker_state["is_running"] = False
        cctv_worker_state["status"] = "stopped"
        logger.info("CCTV worker for %s terminated.", camera_id)


@app.post("/cctv/start")
def start_cctv_stream(req: CctvStartRequest):
    """
    Start server-side CCTV / IP camera stream monitoring in a controlled background thread.
    RTSP credentials are kept on the server and never logged or exposed.
    """
    with cctv_worker_state["lock"]:
        if cctv_worker_state["is_running"]:
            return {
                "status": "already_running",
                "camera_id": cctv_worker_state["camera_id"],
                "message": "CCTV monitoring worker is already active."
            }

        # Resolve stream URL from request or environment
        stream_url = req.stream_url or os.environ.get("CCTV_STREAM_URL")
        if not stream_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No CCTV stream URL provided in request or server environment."
            )

        cctv_worker_state["stop_event"].clear()
        cctv_worker_state["camera_id"] = req.camera_id or "CAM-CCTV-01"
        cctv_worker_state["is_running"] = True
        cctv_worker_state["status"] = "starting"

        thread = threading.Thread(
            target=_cctv_monitor_loop,
            args=(
                stream_url,
                cctv_worker_state["camera_id"],
                req.sample_interval or 4.0,
                req.threshold or 0.65,
                req.backend_ingest_url,
                req.ingest_api_key,
                cctv_worker_state["stop_event"],
            ),
            daemon=True,
            name="CCTV-Violence-Worker"
        )
        cctv_worker_state["thread"] = thread
        thread.start()

        return {
            "status": "started",
            "camera_id": cctv_worker_state["camera_id"],
            "sample_interval": req.sample_interval or 4.0,
            "message": f"CCTV monitoring started for {cctv_worker_state['camera_id']}."
        }


@app.post("/cctv/stop")
def stop_cctv_stream():
    """Stop the background CCTV monitoring worker and release resources."""
    with cctv_worker_state["lock"]:
        if not cctv_worker_state["is_running"]:
            return {
                "status": "not_running",
                "message": "CCTV monitoring worker is not currently active."
            }

        cctv_worker_state["stop_event"].set()
        if cctv_worker_state["thread"]:
            cctv_worker_state["thread"].join(timeout=3.0)

        cctv_worker_state["is_running"] = False
        cctv_worker_state["status"] = "stopped"

        return {
            "status": "stopped",
            "frames_processed": cctv_worker_state["frames_processed"],
            "message": "CCTV monitoring stopped successfully."
        }


@app.get("/cctv/status")
def get_cctv_status():
    """Return the operational status of the CCTV streaming worker."""
    return {
        "is_running": cctv_worker_state["is_running"],
        "status": cctv_worker_state["status"],
        "camera_id": cctv_worker_state["camera_id"],
        "frames_processed": cctv_worker_state["frames_processed"],
        "last_inference_time": cctv_worker_state["last_inference_time"],
        "last_result": cctv_worker_state["last_result"],
        "last_error": cctv_worker_state["last_error"],
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", os.environ.get("VIOLENCE_PORT", 8001)))
    host = os.environ.get("HOST", "127.0.0.1")
    logger.info("Starting Violence Detection FastAPI service on http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port)
