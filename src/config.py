import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
LOGS_DIR = BASE_DIR / "logs"

# Ensure directories exist
MODELS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Load server/.env if present so INGEST_API_KEY is synchronized automatically
server_env = BASE_DIR / "server" / ".env"
if server_env.exists():
    try:
        with open(server_env, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v
    except Exception:
        pass

# Camera configuration
CAMERA_SOURCE = os.getenv("CAMERA_SOURCE", "0")
try:
    CAMERA_SOURCE = int(CAMERA_SOURCE)
except ValueError:
    pass  # Keep as string for RTSP/file paths

def resolve_model_path(model_name: str) -> str:
    """Returns path inside models/ directory if present, otherwise returns model_name."""
    local_path = MODELS_DIR / model_name
    if local_path.exists():
        return str(local_path)
    return model_name


# YOLO Model Configuration
POSE_MODEL_PATH = resolve_model_path(os.getenv("POSE_MODEL_PATH", "yolo26n-pose.pt"))
OBJECT_MODEL_PATH = resolve_model_path(os.getenv("OBJECT_MODEL_PATH", "yolo26n.pt"))

# Tracking Configuration
TRACKER_TYPE = os.getenv("TRACKER_TYPE", "bytetrack.yaml")
TRACK_MAX_INACTIVE_SEC = float(os.getenv("TRACK_MAX_INACTIVE_SEC", "5.0"))

# Detection Parameters
IMG_SIZE = int(os.getenv("IMG_SIZE", "416"))
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.4"))
KEYPOINT_CONF_THRESHOLD = float(os.getenv("KEYPOINT_CONF_THRESHOLD", "0.3"))
OBJECT_INTERVAL = int(os.getenv("OBJECT_INTERVAL", "5"))

# Alert Configuration & Cooldowns
ALERT_COOLDOWN = float(os.getenv("ALERT_COOLDOWN", "5.0"))          # Global alert cooldown
TRACK_ALERT_COOLDOWN = float(os.getenv("TRACK_ALERT_COOLDOWN", "30.0"))  # Per-person alert cooldown
ALERT_LOG_FILE = LOGS_DIR / "alerts.log"

# Backend Ingestion & Forwarding Configuration
BACKEND_INGEST_URL = os.getenv("BACKEND_INGEST_URL", "http://localhost:5000/api/v1/ai/detection")
INGEST_API_KEY = os.getenv("INGEST_API_KEY", "your_ingest_api_key_change_in_production")
CAMERA_ID = os.getenv("CAMERA_ID", "CAM-01")
CAMERA_LOCATION = os.getenv("CAMERA_LOCATION", "Campus CCTV Surveillance Zone")

# --- Fall Detection Temporal & Biomechanical Thresholds ---
# 1. Sudden Vertical Movement (Descent Phase)
FALL_MIN_DESCENT_DELTA_RATIO = float(os.getenv("FALL_MIN_DESCENT_DELTA_RATIO", "0.12"))  # Min drop relative to frame height
FALL_VELOCITY_THRESH = float(os.getenv("FALL_VELOCITY_THRESH", "0.30"))                 # Frame heights per second downward
FALL_DESCENT_MAX_TIME = float(os.getenv("FALL_DESCENT_MAX_TIME", "0.80"))               # Window to evaluate descent speed (seconds)
FALL_DESCENT_MIN_TIME = float(os.getenv("FALL_DESCENT_MIN_TIME", "0.10"))

# 2. Body Orientation & Posture Thresholds
TORSO_HORIZONTAL_THRESH_DEG = float(os.getenv("TORSO_HORIZONTAL_THRESH_DEG", "38.0"))   # Angle from horizontal; <= this is horizontal
TORSO_UPRIGHT_THRESH_DEG = float(os.getenv("TORSO_UPRIGHT_THRESH_DEG", "55.0"))         # Angle from horizontal; >= this is upright
FALL_ASPECT_RATIO = float(os.getenv("FALL_ASPECT_RATIO", "1.15"))                       # width / height (lying down is wide)
UPRIGHT_ASPECT_RATIO = float(os.getenv("UPRIGHT_ASPECT_RATIO", "0.85"))                 # width / height (standing is tall)

# 3. Ground Inactivity & Sustained State
FALL_GROUND_TIME = float(os.getenv("FALL_GROUND_TIME", "1.5"))                           # Must stay down for this long (seconds)
HISTORY_MAXLEN = int(os.getenv("HISTORY_MAXLEN", "30"))                                  # Rolling frame history per person
MIN_HISTORY_FRAMES = int(os.getenv("MIN_HISTORY_FRAMES", "5"))

# --- Dog Interaction Detection Thresholds ---
# 1. Bounding-box proximity (used for initial contact classification)
#    Distance threshold expressed as a ratio of the taller of the two boxes.
DOG_PROXIMITY_RATIO = float(os.getenv("DOG_PROXIMITY_RATIO", "0.75"))

# 2. Overlap (IoU intersection): fraction of the SMALLER box that overlaps the larger box.
#    Values > this suggest very close physical contact rather than just being nearby.
DOG_OVERLAP_THRESH = float(os.getenv("DOG_OVERLAP_THRESH", "0.10"))

# 3. Minimum sustained proximity before any interaction scoring begins (seconds).
#    Prevents fleeting walk-by detections from escalating.
DOG_MIN_PROXIMITY_TIME = float(os.getenv("DOG_MIN_PROXIMITY_TIME", "1.0"))

# 4. Minimum time of CONFIRMED interaction cues (close overlap + movement burst)
#    required before issuing a POSSIBLE_DOG_ATTACK alert.
DOG_MIN_INTERACTION_TIME = float(os.getenv("DOG_MIN_INTERACTION_TIME", "2.0"))

# 5. Movement burst: how much the person's bounding-box center must shift per second
#    while the dog is in proximity (suggests physical jostling, not calm co-existence).
DOG_PERSON_MOVEMENT_BURST = float(os.getenv("DOG_PERSON_MOVEMENT_BURST", "40.0"))  # pixels/sec

# 6. Per-pair alert cooldown (seconds). Avoids repeated alerts for the same dog-person pair.
DOG_PAIR_ALERT_COOLDOWN = float(os.getenv("DOG_PAIR_ALERT_COOLDOWN", "20.0"))

# 7. Maximum frames without a paired observation before interaction tracking resets.
DOG_MAX_INACTIVE_SEC = float(os.getenv("DOG_MAX_INACTIVE_SEC", "3.0"))

# --- Person-to-Person Interaction / Altercation Heuristic Baseline ---
# (Explicitly experimental heuristic for CPU surveillance pipelines)
# 1. Temporal Window & Tracking
FIGHT_SEQUENCE_WINDOW_SEC = float(os.getenv("FIGHT_SEQUENCE_WINDOW_SEC", "2.0"))  # Window length to analyze
FIGHT_PROXIMITY_RATIO = float(os.getenv("FIGHT_PROXIMITY_RATIO", "0.85"))        # Inter-person distance ratio of height
FIGHT_OVERLAP_THRESH = float(os.getenv("FIGHT_OVERLAP_THRESH", "0.08"))           # Box overlap ratio indicating grappling
FIGHT_MIN_DURATION = float(os.getenv("FIGHT_MIN_DURATION", "1.2"))               # Sustained conflict duration required (seconds)
FIGHT_CONF_THRESHOLD = float(os.getenv("FIGHT_CONF_THRESHOLD", "0.65"))           # Threshold to trigger human-review alert
FIGHT_SUSPICIOUS_THRESHOLD = float(os.getenv("FIGHT_SUSPICIOUS_THRESHOLD", "0.40")) # Visual flag threshold
FIGHT_PAIR_ALERT_COOLDOWN = float(os.getenv("FIGHT_PAIR_ALERT_COOLDOWN", "20.0")) # Per-pair alert cooldown (seconds)
FIGHT_MAX_INACTIVE_SEC = float(os.getenv("FIGHT_MAX_INACTIVE_SEC", "3.0"))       # Inactive pair state cleanup

# 2. False Positive Dampeners (Sports, Dancing, Hugging, Crowds)
SPORTS_LINEARITY_THRESH = float(os.getenv("SPORTS_LINEARITY_THRESH", "0.75"))    # Path linearity threshold (high = unidirectional sports/running)
SPORTS_DAMPENER_WEIGHT = float(os.getenv("SPORTS_DAMPENER_WEIGHT", "0.50"))      # Score penalty for unidirectional sports motion
HUG_CALM_MOTION_THRESH = float(os.getenv("HUG_CALM_MOTION_THRESH", "25.0"))      # Max center velocity (px/s) during contact for hug
HUG_DAMPENER_WEIGHT = float(os.getenv("HUG_DAMPENER_WEIGHT", "0.70"))            # Score penalty for calm physical contact
DANCE_JERK_MAX_THRESH = float(os.getenv("DANCE_JERK_MAX_THRESH", "60.0"))        # Upper jerk limit for smooth rhythmic dancing
DANCE_DAMPENER_WEIGHT = float(os.getenv("DANCE_DAMPENER_WEIGHT", "0.40"))        # Score penalty for smooth rhythmic dancing
CROWD_DENSITY_THRESH = int(os.getenv("CROWD_DENSITY_THRESH", "4"))               # Minimum people count to trigger crowd dampener
CROWD_DAMPENER_SCALE = float(os.getenv("CROWD_DAMPENER_SCALE", "0.08"))          # Penalty per person above crowd threshold (max 0.35)

# 3. Altercation Cue Scoring Weights
WEIGHT_PROXIMITY = float(os.getenv("WEIGHT_PROXIMITY", "0.25"))
WEIGHT_JERK = float(os.getenv("WEIGHT_JERK", "0.40"))
WEIGHT_GRAPPLE = float(os.getenv("WEIGHT_GRAPPLE", "0.25"))
WEIGHT_LIMBS = float(os.getenv("WEIGHT_LIMBS", "0.20"))

# Display & Disclaimer Settings
WINDOW_TITLE = "Campus CCTV - Prototype (Human Verification Required)"
BANNER_TEXT = "Campus CCTV - Prototype (Not an Emergency Medical/Safety System)"
DISCLAIMER = "Notice: Prototype heuristic detection. Human verification required. Not a life-safety device."

