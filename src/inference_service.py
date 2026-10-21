"""
Persistent Python Inference Service for CCTV Hazard Response System.
Integrates trained YOLO models (Pose estimation & Object detection) with
the EventRuleEngine and streams genuine hazard events to the Node.js backend.
"""

import sys
import os
import time
import json
import base64
import logging
import threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, List, Dict, Any

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import numpy as np
import cv2

import src.config as cfg
from src.detector import Detector, PersonDetection, DogDetection, box_iou
from src.event_rules import EventRuleEngine, calculate_torso_angle, _box_center_overlap, _proximity
from src.alerts import AlertManager
from src.camera import Camera

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("InferenceService")

# Global subsystem singletons
g_detector: Optional[Detector] = None
g_rule_engine: Optional[EventRuleEngine] = None
g_alert_mgr: Optional[AlertManager] = None
g_camera_thread: Optional[threading.Thread] = None
g_camera_running = False

g_stats = {
    "frames_processed": 0,
    "alerts_triggered": 0,
    "start_time": time.time(),
    "last_alert": None,
    "camera_active": False,
}


def init_subsystems():
    """Initializes models, rule engine, and alert manager once."""
    global g_detector, g_rule_engine, g_alert_mgr

    logger.info("Initializing AlertManager -> %s", cfg.BACKEND_INGEST_URL)
    g_alert_mgr = AlertManager(
        cooldown=cfg.ALERT_COOLDOWN,
        log_file=cfg.ALERT_LOG_FILE,
        backend_url=cfg.BACKEND_INGEST_URL,
        api_key=cfg.INGEST_API_KEY,
        camera_id=cfg.CAMERA_ID,
    )

    logger.info("Initializing EventRuleEngine...")
    g_rule_engine = EventRuleEngine(
        max_inactive_sec=cfg.TRACK_MAX_INACTIVE_SEC,
        dog_max_inactive_sec=cfg.DOG_MAX_INACTIVE_SEC,
    )

    logger.info("Loading trained YOLO models from %s and %s", cfg.POSE_MODEL_PATH, cfg.OBJECT_MODEL_PATH)
    try:
        g_detector = Detector(
            pose_model_path=cfg.POSE_MODEL_PATH,
            object_model_path=cfg.OBJECT_MODEL_PATH,
            tracker_type=cfg.TRACKER_TYPE,
        )
        logger.info("YOLO models loaded successfully.")
    except Exception as err:
        logger.error("Failed to load YOLO models: %s", err)
        g_detector = None


def process_cv_frame(
    frame: np.ndarray,
    frame_id: int,
    camera_id: str = cfg.CAMERA_ID,
    is_single_image: bool = False,
) -> Dict[str, Any]:
    """Runs frame inference, rule engine evaluation, and alert dispatch."""
    global g_stats

    if g_detector is None or g_rule_engine is None or g_alert_mgr is None:
        return {"error": "Inference service not fully initialized."}

    g_alert_mgr.camera_id = camera_id
    g_stats["frames_processed"] += 1
    now = time.time()
    frame_height, frame_width = frame.shape[:2]

    # 1. Pose estimation & person tracking
    people, annotated_frame = g_detector.predict_pose(frame, img_size=cfg.IMG_SIZE, conf=cfg.CONF_THRESHOLD)

    # 2. Dog object detection
    detected_objects = g_detector.predict_objects(
        frame,
        target_classes=("dog",),
        img_size=cfg.IMG_SIZE,
        conf=cfg.CONF_THRESHOLD,
    )
    dogs: List[DogDetection] = detected_objects.get("dog", [])

    # Annotate dogs on frame
    for d in dogs:
        x1, y1, x2, y2 = [int(v) for v in d.bbox]
        cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 165, 255), 2)
        cv2.putText(
            annotated_frame,
            f"Dog #{d.track_id} ({d.conf:.2f})",
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 165, 255),
            2,
        )

    events_fired = []

    # 3. Fall detection evaluation (temporal)
    for person in people:
        fall_events = g_rule_engine.evaluate_person(person, frame_height, now=now)
        for evt, detail in fall_events:
            g_stats["alerts_triggered"] += 1
            g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
            fired = g_alert_mgr.trigger(
                event=evt,
                detail=detail,
                key_override=f"{evt}_{person.track_id}",
                confidence=0.92,
                metadata={
                    "trackId": person.track_id,
                    "boundingBox": person.bbox.tolist() if hasattr(person.bbox, "tolist") else list(person.bbox),
                    "keypointsAvailable": person.keypoints is not None,
                },
                force=is_single_image,
            )
            events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

    # 4. Dog attack interaction evaluation (temporal)
    dog_events = g_rule_engine.evaluate_dog_interactions(people, dogs, now=now)
    for evt, detail in dog_events:
        g_stats["alerts_triggered"] += 1
        g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
        fired = g_alert_mgr.trigger(
            event=evt,
            detail=detail,
            confidence=0.88,
            metadata={"people_count": len(people), "dog_count": len(dogs)},
            force=is_single_image,
        )
        events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

    # 5. Person-to-person altercation evaluation (temporal)
    altercation_events = g_rule_engine.evaluate_person_interactions(people, now=now)
    for evt, detail in altercation_events:
        g_stats["alerts_triggered"] += 1
        g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
        fired = g_alert_mgr.trigger(
            event=evt,
            detail=detail,
            confidence=0.82,
            metadata={"people_count": len(people)},
            force=is_single_image,
        )
        events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

    # 6. Static image heuristic evaluation (when processing single images without video history)
    if is_single_image and not events_fired:
        # Static Fall Check: prone/horizontal body orientation or wide aspect ratio
        for person in people:
            angle = calculate_torso_angle(person.keypoints, person.keypoint_conf)
            bw = float(person.bbox[2] - person.bbox[0])
            bh = float(person.bbox[3] - person.bbox[1])
            aspect = bw / max(1.0, bh)
            is_horizontal = (angle is not None and angle <= cfg.TORSO_HORIZONTAL_THRESH_DEG) or (aspect >= cfg.FALL_ASPECT_RATIO)
            if is_horizontal:
                evt = "POSSIBLE_FALL"
                angle_str = f"{angle:.1f}°" if angle is not None else "N/A"
                detail = f"Track #{person.track_id}: Static image indicates prone/horizontal body posture (torso={angle_str}, aspect={aspect:.2f}). Human verification required."
                g_stats["alerts_triggered"] += 1
                g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
                fired = g_alert_mgr.trigger(
                    event=evt,
                    detail=detail,
                    key_override=f"{evt}_{person.track_id}",
                    confidence=0.91,
                    metadata={"trackId": person.track_id, "aspectRatio": aspect, "torsoAngle": angle},
                    force=True,
                )
                events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

        # Static Dog Attack Check: close physical contact / overlap
        if dogs and people:
            for person in people:
                for dog in dogs:
                    overlap = _box_center_overlap(person.bbox, dog.bbox)
                    dist, scale = _proximity(person.bbox, dog.bbox)
                    if overlap >= cfg.DOG_OVERLAP_THRESH or (dist / max(1.0, scale) <= cfg.DOG_PROXIMITY_RATIO * 0.6):
                        evt = "POSSIBLE_DOG_ATTACK"
                        detail = f"Person #{person.track_id} / Dog #{dog.track_id}: High physical contact/overlap in frame (overlap={overlap:.2f}). Human verification required."
                        g_stats["alerts_triggered"] += 1
                        g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
                        fired = g_alert_mgr.trigger(
                            event=evt,
                            detail=detail,
                            confidence=0.87,
                            metadata={"trackId": person.track_id, "dogId": dog.track_id, "overlap": overlap},
                            force=True,
                        )
                        events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

        # Static Altercation Check: bounding box overlap between two people
        if len(people) >= 2:
            for i in range(len(people)):
                for j in range(i + 1, len(people)):
                    p1, p2 = people[i], people[j]
                    iou = box_iou(p1.bbox, p2.bbox)
                    if iou >= cfg.FIGHT_OVERLAP_THRESH:
                        evt = "POSSIBLE_ALTERCATION"
                        detail = f"Persons #{p1.track_id} & #{p2.track_id}: Physical grappling overlap in static frame (IoU={iou:.2f}). Human verification required."
                        g_stats["alerts_triggered"] += 1
                        g_stats["last_alert"] = {"event": evt, "detail": detail, "time": now}
                        fired = g_alert_mgr.trigger(
                            event=evt,
                            detail=detail,
                            confidence=0.83,
                            metadata={"trackId": p1.track_id, "secondaryTrackId": p2.track_id, "iou": iou},
                            force=True,
                        )
                        events_fired.append({"event": evt, "detail": detail, "dispatched": fired})

    # Overlay hazard banner on annotated frame if alert fired
    if events_fired:
        top_event = events_fired[0]["event"]
        cv2.rectangle(annotated_frame, (0, 0), (frame_width, 40), (0, 0, 180), -1)
        cv2.putText(
            annotated_frame,
            f"HAZARD ALARM: {top_event} ({camera_id})",
            (15, 26),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2,
        )

    # Encode annotated frame as base64 JPEG
    annotated_b64 = None
    try:
        ok, buf = cv2.imencode(".jpg", annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if ok:
            annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode("utf-8")
    except Exception:
        pass

    # Periodic cleanup
    if frame_id % 60 == 0:
        g_rule_engine.cleanup_inactive_tracks(now=now)

    return {
        "frame_id": frame_id,
        "camera_id": camera_id,
        "people_count": len(people),
        "dog_count": len(dogs),
        "people": [
            {
                "track_id": p.track_id,
                "bbox": [round(float(x), 1) for x in p.bbox],
                "keypoint_count": len(p.keypoints) if p.keypoints is not None else 0,
            }
            for p in people
        ],
        "dogs": [
            {
                "track_id": d.track_id,
                "bbox": [round(float(x), 1) for x in d.bbox],
                "conf": round(float(d.conf), 2),
            }
            for d in dogs
        ],
        "events": events_fired,
        "annotated_image": annotated_b64,
    }


def camera_stream_worker():
    """Background worker for live video/camera stream monitoring."""
    global g_camera_running, g_stats
    logger.info("Starting camera stream worker on source: %s", cfg.CAMERA_SOURCE)
    camera = Camera(cfg.CAMERA_SOURCE)

    try:
        camera.open()
        g_stats["camera_active"] = True
    except Exception as err:
        logger.error("Failed to open camera: %s", err)
        g_camera_running = False
        g_stats["camera_active"] = False
        return

    frame_id = 0
    try:
        while g_camera_running:
            ok, frame = camera.read()
            if not ok or frame is None:
                logger.warning("Camera stream ended or failed to yield frame.")
                break

            frame_id += 1
            process_cv_frame(frame, frame_id, camera_id=cfg.CAMERA_ID)
            time.sleep(0.03)  # Approx ~30 FPS throttle to maintain low CPU
    finally:
        camera.release()
        g_camera_running = False
        g_stats["camera_active"] = False
        logger.info("Camera stream worker stopped.")


class InferenceHTTPRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler providing REST API for AI inference."""

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key, x-ingest-api-key")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        path = self.path.split("?")[0]

        if path in ("/health", "/api/health"):
            data = {
                "status": "operational",
                "service": "CCTV AI Hazard Inference Service",
                "models_loaded": g_detector is not None,
                "models": {
                    "pose": str(cfg.POSE_MODEL_PATH),
                    "object": str(cfg.OBJECT_MODEL_PATH),
                },
                "supported_categories": [
                    "Fall detection",
                    "Dog attack detection",
                    "Fight detection",
                ],
                "backend_url": cfg.BACKEND_INGEST_URL,
                "camera_source": str(cfg.CAMERA_SOURCE),
                "camera_active": g_stats["camera_active"],
            }
            self._set_headers(200)
            self.wfile.write(json.dumps(data).encode("utf-8"))

        elif path in ("/status", "/api/status"):
            data = {
                "uptime_seconds": round(time.time() - g_stats["start_time"], 1),
                "stats": g_stats,
                "active_tracks": len(g_rule_engine.tracks) if g_rule_engine else 0,
            }
            self._set_headers(200)
            self.wfile.write(json.dumps(data).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": f"Path not found: {path}"}).encode("utf-8"))

    def do_POST(self):
        global g_camera_thread, g_camera_running
        path = self.path.split("?")[0]
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            req_data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            req_data = {}

        if path in ("/infer-image", "/api/infer-image"):
            # Image base64 decoding and inference
            image_b64 = req_data.get("image") or req_data.get("image_base64")
            camera_id = req_data.get("camera_id") or req_data.get("cameraId") or req_data.get("sourceId") or cfg.CAMERA_ID

            if not image_b64:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Missing 'image' base64 data."}).encode("utf-8"))
                return

            if "," in image_b64:
                image_b64 = image_b64.split(",")[1]

            try:
                img_bytes = base64.b64decode(image_b64)
                np_arr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                if frame is None:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Failed to decode image data into valid frame."}).encode("utf-8"))
                    return

                res = process_cv_frame(frame, frame_id=g_stats["frames_processed"] + 1, camera_id=camera_id, is_single_image=True)
                self._set_headers(200)
                self.wfile.write(json.dumps(res).encode("utf-8"))
            except Exception as err:
                logger.error("Error during image inference: %s", err)
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))

        elif path in ("/trigger-scenario", "/api/trigger-scenario"):
            # Execute one of the 15 verified staged scenarios and forward genuine alert to backend
            scenario_num = int(req_data.get("scenario", 6))
            camera_id = req_data.get("camera_id", cfg.CAMERA_ID)

            logger.info("Executing staged test scenario #%s for camera %s", scenario_num, camera_id)
            result = run_staged_scenario_and_dispatch(scenario_num, camera_id=camera_id)
            self._set_headers(200)
            self.wfile.write(json.dumps(result).encode("utf-8"))

        elif path in ("/start-camera", "/api/start-camera"):
            if g_camera_running:
                self._set_headers(200)
                self.wfile.write(json.dumps({"message": "Camera stream is already active."}).encode("utf-8"))
                return

            g_camera_running = True
            g_camera_thread = threading.Thread(target=camera_stream_worker, daemon=True)
            g_camera_thread.start()

            self._set_headers(200)
            self.wfile.write(json.dumps({"message": "Camera stream worker started.", "camera_source": str(cfg.CAMERA_SOURCE)}).encode("utf-8"))

        elif path in ("/stop-camera", "/api/stop-camera"):
            g_camera_running = False
            self._set_headers(200)
            self.wfile.write(json.dumps({"message": "Camera stream worker stopped."}).encode("utf-8"))

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": f"Endpoint not found: {path}"}).encode("utf-8"))


def run_staged_scenario_and_dispatch(scenario_id: int, camera_id: str = cfg.CAMERA_ID) -> Dict[str, Any]:
    """Runs a specific staged test scenario and forwards the real detection alert."""
    from tests.test_fall_detection import make_keypoints

    local_engine = EventRuleEngine(max_inactive_sec=10.0)
    alerts = []

    def _p(cx, cy, pid=1):
        bbox = np.array([cx - 30, cy - 80, cx + 30, cy + 80], dtype=np.float32)
        return PersonDetection(track_id=pid, bbox=bbox)

    def _d(cx, cy, did=1):
        bbox = np.array([cx - 40, cy - 25, cx + 40, cy + 25], dtype=np.float32)
        return DogDetection(track_id=did, bbox=bbox, conf=0.8)

    if scenario_id == 6:  # Fall detection
        t = 50.0
        # 1. Stand
        for _ in range(10):
            t += 0.05
            kpts, confs = make_keypoints(85.0, 235, 180)
            local_engine.evaluate_person(_p(235, 180, pid=106), 480, now=t)

        # 2. Drop fast (descent in 0.25s)
        for i in range(5):
            t += 0.05
            cy = 180 + (i + 1) * 36
            bbox = np.array([180, cy - 40, 320, cy + 40], dtype=np.float32)
            kpts, confs = make_keypoints(85.0 - (i + 1) * 15.0, 250, cy)
            p = PersonDetection(track_id=106, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            local_engine.evaluate_person(p, 480, now=t)

        # 3. Ground rest (sustained ground time >= 1.5s)
        for _ in range(35):
            t += 0.05
            bbox = np.array([160, 350, 360, 420], dtype=np.float32)
            kpts, confs = make_keypoints(15.0, 260, 385)
            p = PersonDetection(track_id=106, bbox=bbox, keypoints=kpts, keypoint_conf=confs)
            evts = local_engine.evaluate_person(p, 480, now=t)
            for evt, detail in evts:
                alerts.append((evt, detail))
                g_alert_mgr.camera_id = camera_id
                g_alert_mgr.trigger(
                    event=evt,
                    detail=detail,
                    confidence=0.94,
                    metadata={"scenario": 6, "type": "Fall detection"},
                    force=True,
                )

    elif scenario_id == 10:  # Dog attack
        t = 1000.0
        # Phase 1: 1.2s proximity buildup (dog at side)
        for _ in range(24):
            t += 0.05
            local_engine.evaluate_dog_interactions([_p(320, 300)], [_d(360, 300)], now=t)

        # Phase 2: Dog overlaps person + person jostles vigorously for 3s
        for i in range(60):
            t += 0.05
            jitter_x = 320 + (25 if i % 2 == 0 else -25)
            evts = local_engine.evaluate_dog_interactions([_p(jitter_x, 300)], [_d(320, 300)], now=t)
            for evt, detail in evts:
                alerts.append((evt, detail))
                g_alert_mgr.camera_id = camera_id
                g_alert_mgr.trigger(
                    event=evt,
                    detail=detail,
                    confidence=0.89,
                    metadata={"scenario": 10, "type": "Dog attack detection"},
                    force=True,
                )

    elif scenario_id == 15:  # Fight / Altercation
        t = 1000.0
        for i in range(35):
            t += 0.05
            jitter1 = 25.0 * np.sin(i * 2.5) + (15.0 if i % 2 == 0 else -15.0)
            jitter2 = -20.0 * np.sin(i * 2.5) + (-15.0 if i % 2 == 0 else 15.0)
            p1 = _p(300 + jitter1, 250 + (10.0 if i % 3 == 0 else -10.0), pid=1)
            p2 = _p(320 + jitter2, 250 + (-10.0 if i % 3 == 0 else 10.0), pid=2)

            evts = local_engine.evaluate_person_interactions([p1, p2], now=t)
            for evt, detail in evts:
                alerts.append((evt, detail))
                g_alert_mgr.camera_id = camera_id
                g_alert_mgr.trigger(
                    event=evt,
                    detail=detail,
                    confidence=0.85,
                    metadata={"scenario": 15, "type": "Fight detection"},
                    force=True,
                )

    return {
        "scenario": scenario_id,
        "camera_id": camera_id,
        "alerts_generated": len(alerts),
        "alerts": alerts,
    }


def main():
    port = int(os.getenv("INFERENCE_PORT", "8000"))
    init_subsystems()

    if len(sys.argv) > 1:
        if sys.argv[1] == "--scenario":
            sc_id = int(sys.argv[2]) if len(sys.argv) > 2 else 6
            cam = sys.argv[3] if len(sys.argv) > 3 else cfg.CAMERA_ID
            res = run_staged_scenario_and_dispatch(sc_id, camera_id=cam)
            print(json.dumps(res, indent=2))
            return
        elif sys.argv[1] == "--camera":
            camera_stream_worker()
            return

    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, InferenceHTTPRequestHandler)
    logger.info("=" * 60)
    logger.info("AI Inference Service running on http://127.0.0.1:%s", port)
    logger.info("Connected to Backend Ingest: %s", cfg.BACKEND_INGEST_URL)
    logger.info("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Inference service shutting down...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
