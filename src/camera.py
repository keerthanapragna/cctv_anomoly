import logging
import cv2

logger = logging.getLogger(__name__)


class Camera:
    """Manages video capture from local webcams, RTSP streams, or video files."""

    def __init__(self, source):
        self.source = source
        self.cap = None

    def open(self):
        """Initializes the video capture device."""
        self.cap = cv2.VideoCapture(self.source)
        if not self.cap.isOpened():
            raise RuntimeError(
                f"Cannot open camera source: {self.source}. "
                "Check connection or permissions."
            )
        logger.info("Camera source %s opened successfully.", self.source)
        return self

    def is_opened(self) -> bool:
        """Checks if the video capture is currently open."""
        return self.cap is not None and self.cap.isOpened()

    def read(self):
        """
        Reads the next frame from the camera.
        Returns:
            tuple: (ok: bool, frame: np.ndarray or None)
        """
        if not self.is_opened():
            return False, None
        return self.cap.read()

    def get_dimensions(self):
        """Returns (width, height) of the video feed."""
        if not self.is_opened():
            return (0, 0)
        width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        return (width, height)

    def release(self):
        """Releases the video capture device."""
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            logger.info("Camera source released.")

    def __enter__(self):
        return self.open()

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()
