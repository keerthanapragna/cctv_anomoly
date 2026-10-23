import os

# =====================
# Paths
# =====================

# Get the root folder of your project automatically
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

# =====================
# Video preprocessing
# =====================

NUM_FRAMES = 16
FRAME_SIZE = (224, 224)
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# =====================
# Dataset split
# =====================

TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15
RANDOM_SEED = 42

# =====================
# DataLoader
# =====================

BATCH_SIZE = 4
NUM_WORKERS = 2
