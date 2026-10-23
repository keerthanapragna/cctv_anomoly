# app/app.py
import os
import sys
import tempfile
from pathlib import Path

# =========================
# Project root for imports
# =========================
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

import streamlit as st
import torch
from src.video_utils import load_video_frames
from src.load_model import load_trained_model

# =========================
# Page config
# =========================
st.set_page_config(
    page_title="🔥 Violence Detection in Videos",
    layout="wide"
)

# =========================
# App Title & Description
# =========================
st.title("🔥 Violence Detection in Videos")
st.markdown(
    """
    Upload a video and get a **real-time prediction** if it is violent or non-violent.
    Wait a few seconds for model prediction. Probabilities are shown as progress bars.
    """
)

# =========================
# Load model (cached)
# =========================
@st.cache_resource(show_spinner=False)
def get_cached_model():
    return load_trained_model()

with st.spinner("Loading model..."):
    model, device = get_cached_model()

# =========================
# Video Upload
# =========================
uploaded_file = st.file_uploader(
    "Upload a video file",
    type=["mp4", "avi", "mov", "mkv"],
    help="Supported formats: MP4, AVI, MOV, MKV"
)

if uploaded_file is not None:
    if uploaded_file.size == 0:
        st.error("Uploaded video file is empty (0 bytes). Please upload a valid video.")
    else:
        # Save uploaded video to a temporary file with the proper extension
        file_suffix = Path(uploaded_file.name).suffix or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_suffix) as tfile:
            tfile.write(uploaded_file.getbuffer())
            video_path = tfile.name

        try:
            # Display video and prediction side by side
            with st.container():
                col1, col2 = st.columns([1.3, 1])

                with col1:
                    st.subheader("Video Preview")
                    st.markdown("<div style='max-width:300px'>", unsafe_allow_html=True)
                    st.video(uploaded_file)
                    st.markdown("</div>", unsafe_allow_html=True)

                with col2:
                    st.subheader("Prediction")
                    with st.spinner("Analyzing video..."):
                        try:
                            # Load frames and prepare tensor: [1, frames, channels, height, width]
                            raw_tensor = load_video_frames(video_path)

                            # Validate extracted frames
                            if raw_tensor.abs().sum() == 0:
                                st.warning("⚠️ Could not extract valid frames from the video. Please verify the video format and contents.")
                            else:
                                video_tensor = raw_tensor.unsqueeze(0).to(device)
                                THRESHOLD = 0.65

                                # Forward pass
                                with torch.no_grad():
                                    logits, uncertainty = model(video_tensor)
                                    prob = torch.sigmoid(logits).item()
                                    uncertainty_score = uncertainty.item()

                                    violence_prob = prob * 100
                                    non_violence_prob = 100 - violence_prob

                                # Display probabilities
                                st.markdown("**Violence Probability**")
                                st.progress(min(max(violence_prob / 100.0, 0.0), 1.0))
                                st.markdown("**Non-Violence Probability**")
                                st.progress(min(max(non_violence_prob / 100.0, 0.0), 1.0))

                                st.markdown(f"**Model probability:** {prob:.4f}")
                                st.markdown(f"**Decision threshold:** {THRESHOLD:.2f}")
                                st.markdown(f"**Uncertainty score:** {uncertainty_score:.4f}")

                                # Highlight main prediction
                                if prob > THRESHOLD:
                                    st.error("⚠️ This video is violent.")
                                else:
                                    st.success("✅ This video is non-violent.")

                        except Exception as e:
                            st.error(f"Error processing video: {e}")

        finally:
            # Ensure cleanup of temp file on disk
            try:
                if os.path.exists(video_path):
                    os.remove(video_path)
            except Exception:
                pass

# =========================
# Footer
# =========================
st.markdown("---")
st.markdown(
    "Developed with ❤️ by RIHAM | [GitHub Repo](https://github.com/riham-esi/Violence-Detection-video.git)"
)