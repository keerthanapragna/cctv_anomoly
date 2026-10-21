import logging
from dataclasses import dataclass
from typing import Optional, List, Dict
import numpy as np
try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

import src.config as cfg

logger = logging.getLogger(__name__)


def box_center(box):
    """Calculates the (x, y) center of an [x1, y1, x2, y2] bounding box."""
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def box_iou(boxA, boxB):
    """Calculates Intersection over Union (IoU) of two bounding boxes."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    inter_w = max(0.0, xB - xA)
    inter_h = max(0.0, yB - yA)
    inter_area = inter_w * inter_h

    boxA_area = max(1e-5, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    boxB_area = max(1e-5, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

    return inter_area / (boxA_area + boxB_area - inter_area)


@dataclass
class PersonDetection:
    """Represents a single tracked person detection with keypoints."""
    track_id: int
    bbox: np.ndarray             # [x1, y1, x2, y2]
    keypoints: Optional[np.ndarray] = None      # Shape: (17, 2)
    keypoint_conf: Optional[np.ndarray] = None  # Shape: (17,)


@dataclass
class DogDetection:
    """Represents a single tracked dog detection with a persistent ID."""
    track_id: int
    bbox: np.ndarray   # [x1, y1, x2, y2]
    conf: float = 0.0


class FallbackTracker:
    """Lightweight Centroid & IoU tracker for frames where model tracker is unassigned."""

    def __init__(self, max_distance=100.0, min_iou=0.2):
        self.next_id = 1
        self.tracks: Dict[int, np.ndarray] = {}  # track_id -> bbox
        self.max_distance = max_distance
        self.min_iou = min_iou

    def update(self, bboxes: List[np.ndarray]) -> List[int]:
        if not bboxes:
            return []

        assigned_ids = [None] * len(bboxes)
        unmatched_bboxes = set(range(len(bboxes)))
        unmatched_tracks = set(self.tracks.keys())

        # Match existing tracks with highest IoU
        for b_idx in list(unmatched_bboxes):
            bbox = bboxes[b_idx]
            best_id = None
            best_score = -1.0

            for t_id in list(unmatched_tracks):
                t_bbox = self.tracks[t_id]
                iou = box_iou(bbox, t_bbox)
                c1 = box_center(bbox)
                c2 = box_center(t_bbox)
                dist = np.hypot(c1[0] - c2[0], c1[1] - c2[1])

                if iou >= self.min_iou or dist <= self.max_distance:
                    score = iou - (dist / 1000.0)
                    if score > best_score:
                        best_score = score
                        best_id = t_id

            if best_id is not None:
                assigned_ids[b_idx] = best_id
                self.tracks[best_id] = bbox
                unmatched_bboxes.remove(b_idx)
                unmatched_tracks.remove(best_id)

        # Assign new IDs for unmatched detections
        for b_idx in unmatched_bboxes:
            new_id = self.next_id
            self.next_id += 1
            self.tracks[new_id] = bboxes[b_idx]
            assigned_ids[b_idx] = new_id

        return assigned_ids


class Detector:
    """Encapsulates YOLO pose and object detection models with persistent tracking."""

    def __init__(
        self,
        pose_model_path=cfg.POSE_MODEL_PATH,
        object_model_path=cfg.OBJECT_MODEL_PATH,
        tracker_type=cfg.TRACKER_TYPE,
    ):
        self.pose_model = self._load_model(pose_model_path, fallback="yolov8n-pose.pt")
        self.object_model = self._load_model(object_model_path, fallback="yolov8n.pt")
        self.tracker_type = tracker_type
        self.fallback_tracker = FallbackTracker()        # For person tracking
        self.dog_fallback_tracker = FallbackTracker()    # Separate namespace for dog IDs

    def _load_model(self, model_path, fallback=None):
        if YOLO is None:
            raise RuntimeError(
                "Ultralytics is not installed. Please install it with 'pip install ultralytics'."
            )
        try:
            logger.info("Loading YOLO model: %s", model_path)
            return YOLO(model_path)
        except Exception as err:
            if fallback and fallback != model_path:
                logger.warning(
                    "Failed to load %s (%s). Attempting fallback to %s",
                    model_path, err, fallback
                )
                return YOLO(fallback)
            raise

    def predict_pose(self, frame, img_size=cfg.IMG_SIZE, conf=cfg.CONF_THRESHOLD):
        """
        Runs pose estimation with persistent tracking.
        Returns:
            people (list[PersonDetection]): Tracked person objects with keypoints.
            annotated_frame (np.ndarray): Frame with pose overlays.
        """
        # Run Ultralytics tracking with ByteTrack
        try:
            results = self.pose_model.track(
                frame,
                persist=True,
                tracker=self.tracker_type,
                imgsz=img_size,
                conf=conf,
                verbose=False,
            )[0]
        except Exception:
            # Fallback to standard predict if track fails
            results = self.pose_model.predict(
                frame,
                imgsz=img_size,
                conf=conf,
                verbose=False,
            )[0]

        people: List[PersonDetection] = []
        raw_boxes = []
        raw_keypoints = []
        raw_keypoint_confs = []
        model_track_ids = []

        if results.boxes is not None and len(results.boxes) > 0:
            for i, box in enumerate(results.boxes):
                cls_id = int(box.cls[0])
                if results.names.get(cls_id) == "person":
                    xyxy = box.xyxy[0].cpu().numpy()
                    raw_boxes.append(xyxy)

                    t_id = None
                    if box.id is not None:
                        try:
                            t_id = int(box.id[0].item())
                        except (ValueError, IndexError, AttributeError):
                            pass
                    model_track_ids.append(t_id)

                    # Extract keypoints
                    if results.keypoints is not None and len(results.keypoints.xy) > i:
                        kpts = results.keypoints.xy[i].cpu().numpy()
                        kpt_conf = (
                            results.keypoints.conf[i].cpu().numpy()
                            if results.keypoints.conf is not None
                            else None
                        )
                        raw_keypoints.append(kpts)
                        raw_keypoint_confs.append(kpt_conf)
                    else:
                        raw_keypoints.append(None)
                        raw_keypoint_confs.append(None)

        # Resolve track IDs (fill missing with fallback tracker)
        if raw_boxes:
            fallback_ids = self.fallback_tracker.update(raw_boxes)
            for idx, box in enumerate(raw_boxes):
                assigned_id = model_track_ids[idx]
                if assigned_id is None or assigned_id < 0:
                    assigned_id = fallback_ids[idx]

                people.append(
                    PersonDetection(
                        track_id=assigned_id,
                        bbox=box,
                        keypoints=raw_keypoints[idx],
                        keypoint_conf=raw_keypoint_confs[idx],
                    )
                )

        annotated_frame = results.plot()
        return people, annotated_frame

    def predict_objects(
        self,
        frame,
        target_classes=("dog",),
        img_size=cfg.IMG_SIZE,
        conf=cfg.CONF_THRESHOLD,
    ) -> Dict[str, list]:
        """
        Runs generic object detection and assigns persistent IDs to detected dogs.
        Returns:
            dict[str, list]: Mapping of class name to:
                - list[DogDetection] for 'dog'
                - list[np.ndarray] for all other classes
        """
        results = self.object_model.predict(
            frame, imgsz=img_size, conf=conf, verbose=False
        )[0]

        detected: Dict[str, list] = {cls_name: [] for cls_name in target_classes}
        dog_boxes_raw: List[np.ndarray] = []
        dog_confs_raw: List[float] = []

        if results.boxes is not None:
            for box in results.boxes:
                cls_id = int(box.cls[0])
                name = results.names.get(cls_id)
                if name not in detected:
                    continue
                xyxy = box.xyxy[0].cpu().numpy()
                conf_val = float(box.conf[0].cpu().numpy())
                if name == "dog":
                    dog_boxes_raw.append(xyxy)
                    dog_confs_raw.append(conf_val)
                else:
                    detected[name].append(xyxy)

        # Assign stable IDs to dog bounding boxes
        if dog_boxes_raw:
            dog_ids = self.dog_fallback_tracker.update(dog_boxes_raw)
            for idx, (bbox, did, conf_val) in enumerate(
                zip(dog_boxes_raw, dog_ids, dog_confs_raw)
            ):
                detected["dog"].append(
                    DogDetection(track_id=did, bbox=bbox, conf=conf_val)
                )

        return detected
