# src/load_model.py
import os
import torch
from models.model import HybridVideoClassifier
from configs.config import BASE_DIR


def resolve_model_path(model_path="hybrid_model3.pth"):
    """Resolve model checkpoint path from absolute, relative, or models/ directory."""
    if os.path.isabs(model_path) and os.path.isfile(model_path):
        return model_path
    if os.path.isfile(model_path):
        return os.path.abspath(model_path)
    base_rel = os.path.join(BASE_DIR, model_path)
    if os.path.isfile(base_rel):
        return base_rel
    models_dir_path = os.path.join(BASE_DIR, "models", model_path)
    if os.path.isfile(models_dir_path):
        return models_dir_path
    raise FileNotFoundError(
        f"Model checkpoint not found. Looked at: '{model_path}', '{base_rel}', and '{models_dir_path}'"
    )


def load_trained_model(model_path="hybrid_model3.pth", device=None):
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(device)

    model = HybridVideoClassifier(
        num_classes=1,
        freeze_backbone=True,
        fine_tune_layer4=True,
        pretrained=False
    ).to(device)

    full_path = resolve_model_path(model_path)

    # Use safer weights_only=True where compatible with PyTorch version
    try:
        state_dict = torch.load(full_path, map_location=device, weights_only=True)
    except TypeError:
        # Fallback for older PyTorch versions that do not support weights_only parameter
        state_dict = torch.load(full_path, map_location=device)

    if isinstance(state_dict, dict):
        if "state_dict" in state_dict:
            state_dict = state_dict["state_dict"]
        elif "model_state_dict" in state_dict:
            state_dict = state_dict["model_state_dict"]

    model.load_state_dict(state_dict, strict=True)
    model.eval()

    return model, device