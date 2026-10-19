# Campus CCTV Monitoring System

A modular, real-time computer vision monitoring prototype built with OpenCV and Ultralytics YOLO. It performs persistent person tracking, periodic object detection, temporal fall detection, dog interaction classification, and person-to-person altercation detection with false-positive rejection.

> [!WARNING]
> **Safety Notice & Disclaimer**: This system is an **explicitly experimental heuristic prototype** intended solely for situational awareness assistance. It is **NOT** a certified life-safety, emergency response, violence prevention, or medical alert device. All alerts represent unconfirmed candidates and strictly require human visual verification.

---

## Video Action-Recognition Model Investigation & Licenses

As part of designing lightweight action recognition for campus surveillance on CPU:

### 1. Evaluated Architectures

| Architecture | Parameters & Size | Pretrained Dataset | Licensing | CPU Compatibility & Surveillance Suitability |
|---|---|---|---|---|
| **MoViNet (A0–A2)** | ~3.1M – 5.2M (~12–25 MB) | Kinetics-600 | Apache 2.0 | Designed for mobile/edge. However, primarily native to TensorFlow / TF Hub; PyTorch ports lack ongoing maintenance. Dataset lacks a dedicated violence class. |
| **X3D (XS / S)** | ~3.8M – 6.1M (~15–30 MB) | Kinetics-400 | Apache 2.0 (PyTorchVideo) | Lightweight 3D CNN. However, PyTorchVideo library is archived/deprecated. Trained on general YouTube human activities (sports, crafts, cooking); lacks interpersonal fight classes. |
| **R2Plus1D-18** | ~31.5M (~125 MB) | Kinetics-400 | BSD 3-Clause | Bundled in Torchvision. However, heavy CPU latency (~1200ms–2500ms per 16-frame clip on standard CPUs), unsuitable for real-time edge processing without GPU acceleration. No dedicated violence class. |
| **SlowFast (4x16)** | ~34M (~140 MB) | Kinetics-400 / AVA | Apache 2.0 | Dual-pathway network. Extremely compute-heavy on CPU (>3000ms latency). AVA labels atomic actions (e.g. "push", "touch"), not full fight interactions. |
| **VideoMAE / TimeSformer** | >85M (>300 MB) | Kinetics-400 | CC-BY-NC 4.0 / Apache 2.0 | Video vision transformers require high-memory GPUs; prohibitive on commodity CCTV CPUs. Non-commercial license barriers on several pretrained weights. |

### 2. Dataset & Practical CCTV Limitations
- **Kinetics-400 / Kinetics-600**: The standard open pretrained video action datasets contain everyday human actions (e.g. *hugging, high five, dancing, gymnastics, wrestling as a sport, playing instruments*). They **do not include a general violence/assault class**. Relying on "wrestling" or "boxing" classes causes extreme false positives on campus sports or dancing.
- **Dedicated Violence Datasets (UCF-Crime, RWF-2000)**: Pretrained models are non-standard, often restricted by non-commercial research licenses, and downloading multi-gigabyte video datasets without user consent is avoided.
- **CPU Inference Constraint**: Running 3D spatio-temporal convolutions or video transformers per person pair on CPU introduces latency bottlenecks (hundreds of milliseconds to seconds per clip) that break live stream throughput.

### 3. Adopted Solution: Experimental Interaction-Rule Baseline
In accordance with system requirements, an **explicitly experimental interaction-rule baseline** was implemented:
- Operates directly on the existing shared YOLO pose tracking detections.
- **Zero extra weight downloads** and **near-zero CPU overhead** (~0.1ms per frame).
- Analyzes sliding temporal sequences (1.5s–3.0s) of interpersonal trajectories, bounding box kinematics, and keypoint movement.
- Formulates multi-factor confidence scoring with explicit false-positive dampeners.

---

## Project Structure

```
campus-cctv/
├── models/                         # YOLO model weights (*.pt)
├── src/
│   ├── main.py                     # Main monitoring pipeline and annotated UI loop
│   ├── camera.py                   # Camera capture lifecycle (webcam, RTSP, video files)
│   ├── detector.py                 # YOLO pose/track wrapper with ByteTrack & fallback tracker
│   ├── event_rules.py              # Temporal state machines: falls, dog interaction, altercations
│   ├── alerts.py                   # Cooldown-throttled alert manager with file & console logging
│   ├── config.py                   # Configurable thresholds, cooldowns, and weights
│   └── staged_tests.py             # 15 interactive staged scenarios (unit verification)
├── tests/
│   ├── test_fall_detection.py      # Unit tests for fall state machine & posture heuristics
│   ├── test_dog_interaction.py     # Unit tests for dog proximity & interaction cues
│   └── test_person_interaction.py  # Unit tests for altercation detection & false-positive dampeners
├── logs/                           # Persistent alert logs (alerts.log)
├── requirements.txt                # Python dependencies
├── .gitignore                      # Git exclusion rules
└── README.md                       # Documentation and usage guide
```

---

## Key Safety Pipelines & Heuristics

### 1. Person-to-Person Altercation Detection (Temporal Sequence Analysis)
Tracks interpersonal dynamics between every pair of detected people $(P_A, P_B)$:

- **Sequence Window**: Evaluates a rolling temporal window ($1.5\text{s} - 3.0\text{s}$) to measure dynamics over time.
- **Aggressive Cues**:
  - Mutual proximity and physical contact (bounding box overlap fraction $\ge 8\%$).
  - Erratic kinetic motion / jerk: non-uniform acceleration vectors and velocity variance resulting from grappling and shoving.
  - Dynamic limb movement: arm/wrist thrusts relative to torso.
- **False-Positive Mitigation Dampeners**:
  - **Sports / Running**: Measures trajectory linearity $L = \frac{\|\text{net displacement}\|}{\text{path length}}$. Unidirectional motion ($L \ge 0.75$) with high speed suppresses the score via `SPORTS_DAMPENER_WEIGHT`.
  - **Friendly Gestures / Hugging**: In an embrace, people overlap closely but **kinetic movement drops near zero** ($\le 25\text{px/s}$). Suppressed via `HUG_DAMPENER_WEIGHT`.
  - **Dancing / Coordinated Movement**: Computes velocity vector correlation $\rho_{coord} = \text{mean}\left(\frac{\vec{v}_1 \cdot \vec{v}_2}{\|\vec{v}_1\| \|\vec{v}_2\|}\right)$. Synchronized motion ($\rho_{coord} \ge 0.50$) with stable distance suppresses the score via `DANCE_DAMPENER_WEIGHT`.
  - **Crowds / High Density**: High pedestrian density ($\ge 4$ people in frame) without acute agitation activates a graduated crowd dampener.
- **Composite Confidence**:
  $$C = \text{clip}\Big(w_{prox} S_{prox} + w_{jerk} S_{jerk} + w_{grapple} S_{grapple} + w_{limbs} S_{limbs} - \sum D, 0.0, 1.0\Big)$$
  Triggers a `POSSIBLE_ALTERCATION` alert only when $C \ge \text{FIGHT_CONF_THRESHOLD}$ (default: 0.65) sustained for $\ge 1.2\text{s}$.
  All alerts explicitly include `[HUMAN REVIEW REQUIRED]`.

### 2. Temporal Fall Detection State Machine
Evaluates per-person persistent trajectories:
1. `UPRIGHT` $\to$ Walking/standing baseline.
2. `DESCENT_DETECTED` $\to$ Rapid downward vertical velocity spike ($> 0.30\text{H/s}$) within $0.1\text{s} - 0.8\text{s}$.
3. `ON_GROUND` $\to$ Posture becomes horizontal (torso angle $\le 38^\circ$ or aspect ratio $> 1.15$). Must remain on ground for $\ge 1.5\text{s}$.
4. `ALERTED` $\to$ Dispatches `POSSIBLE_FALL` alert.
- **False Positive Rejection**: Sitting down, bending to tie shoes, kneeling down, and slow lying down are rejected because torso stays upright or descent velocity is controlled.

### 3. Dog Interaction Heuristics
Identifies dogs using the periodic object detector (every 5 frames to conserve CPU) and tracks interaction state per (person, dog) pair:
- `CLEAR` $\to$ `PROXIMITY` (dog within radius) $\to$ `INTERACTION` (overlap $\ge 10\%$ + person movement burst $> 40\text{px/s}$) $\to$ `ALERTED` (`POSSIBLE_DOG_ATTACK`).
- **Rejection**: Passing dogs and stationary resting dogs do not trigger alerts.

---

## Installation & Setup

### 1. Activate Virtual Environment
```powershell
.\.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

## Running Verification & Tests

### Automated Unit Tests (25 Tests)
```powershell
python -m unittest discover tests
```

### Interactive Staged Scenario Runner (15 Scenarios)
```powershell
python src/staged_tests.py
```

Scenarios tested:
- **Scenarios 1–7 (Falls)**: Normal walking, sitting, bending, kneeling, gentle lying down, sudden fall (alerts), stumble & recovery.
- **Scenarios 8–10 (Dogs)**: Passing dog, stationary dog, staged aggressive attack (alerts).
- **Scenarios 11–15 (Altercations)**: Friendly hug (rejected), jogging/sprinting (rejected), dancing (rejected), dense crowd walking (rejected), staged physical altercation (alerts).

---

## Live CCTV Monitoring

Run the live monitoring pipeline using camera source 0:
```powershell
python src/main.py
```
Press **`q`** while focused on the display window to cleanly exit.

---

## Configuration Reference

All settings in [`src/config.py`](file:///c:/cctv/src/config.py) can be overridden via environment variables:

| Variable | Default | Description |
|---|---|---|
| `CAMERA_SOURCE` | `0` | Camera index (`0`), RTSP URL, or video file path |
| `POSE_MODEL_PATH` | `yolo26n-pose.pt` | YOLO pose estimation weights |
| `OBJECT_MODEL_PATH` | `yolo26n.pt` | YOLO object detection weights |
| `TRACKER_TYPE` | `bytetrack.yaml` | Tracker configuration file |
| `FALL_VELOCITY_THRESH` | `0.30` | Min downward velocity (frame heights / sec) |
| `FALL_GROUND_TIME` | `1.5` | Required duration person must stay down (seconds) |
| `TORSO_HORIZONTAL_THRESH_DEG` | `38.0` | Torso angle from horizontal considered fallen |
| `DOG_PROXIMITY_RATIO` | `0.75` | Proximity threshold ratio of taller bounding box |
| `DOG_MIN_INTERACTION_TIME` | `2.0` | Sustained contact duration required for dog alert |
| `FIGHT_SEQUENCE_WINDOW_SEC` | `2.0` | Temporal window to analyze for altercation sequences |
| `FIGHT_CONF_THRESHOLD` | `0.65` | Confidence threshold to trigger `POSSIBLE_ALTERCATION` |
| `FIGHT_SUSPICIOUS_THRESHOLD` | `0.40` | Confidence threshold for visual monitoring flag |
| `FIGHT_MIN_DURATION` | `1.2` | Minimum duration of conflict required before alert |
| `SPORTS_LINEARITY_THRESH` | `0.75` | Path linearity threshold (running / sports rejection) |
| `SPORTS_DAMPENER_WEIGHT` | `0.50` | Confidence penalty for unidirectional sports motion |
| `HUG_CALM_MOTION_THRESH` | `25.0` | Max velocity (px/s) for calm contact / friendly hug |
| `HUG_DAMPENER_WEIGHT` | `0.70` | Confidence penalty for calm physical contact |
| `DANCE_DAMPENER_WEIGHT` | `0.40` | Confidence penalty for synchronized velocity coordination |
| `CROWD_DENSITY_THRESH` | `4` | Number of people in frame to activate crowd dampener |
| `FIGHT_PAIR_ALERT_COOLDOWN` | `20.0` | Cooldown period per person pair (seconds) |
