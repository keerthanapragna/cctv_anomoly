import time
import logging
import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any
import src.config as cfg

logger = logging.getLogger(__name__)


class AlertManager:
    """Handles rate-limiting, persistent logging, and backend dispatching of safety alerts."""

    def __init__(
        self,
        cooldown: float = cfg.ALERT_COOLDOWN,
        log_file: Path = cfg.ALERT_LOG_FILE,
        backend_url: str = cfg.BACKEND_INGEST_URL,
        api_key: str = cfg.INGEST_API_KEY,
        camera_id: str = cfg.CAMERA_ID,
    ):
        self.cooldown = cooldown
        self.log_file = Path(log_file)
        self.backend_url = backend_url
        self.api_key = api_key
        self.camera_id = camera_id
        self.last_alert = {}
        self._ensure_log_file()

    def _ensure_log_file(self):
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def _dispatch_to_backend(
        self,
        event: str,
        detail: str,
        confidence: float = 0.85,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Sends genuine detection to Node.js backend ingestion endpoint."""
        if not self.backend_url or not self.api_key:
            return

        payload = {
            "category": event,
            "confidence": confidence,
            "cameraId": self.camera_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "details": detail,
            "metadata": metadata or {},
        }

        try:
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.backend_url,
                data=req_data,
                headers={
                    "Content-Type": "application/json",
                    "x-ingest-api-key": self.api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status in (200, 201):
                    logger.info("Successfully dispatched alert %s to backend (status %s)", event, resp.status)
        except urllib.error.HTTPError as err:
            logger.warning("Backend rejected alert %s: HTTP %s (%s)", event, err.code, err.reason)
        except Exception as err:
            logger.warning("Backend unreachable for alert %s (%s)", event, err)

    def trigger(
        self,
        event: str,
        detail: str,
        key_override: Optional[str] = None,
        confidence: float = 0.85,
        metadata: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> bool:
        """
        Triggers an alert if cooldown period has elapsed (or if force=True).
        Returns:
            bool: True if alert was fired, False if throttled.
        """
        now = time.time()
        # Allows cooldown per specific track or event
        key = key_override if key_override is not None else event

        if not force and (now - self.last_alert.get(key, 0.0) < self.cooldown):
            return False

        self.last_alert[key] = now
        full_timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        time_str = time.strftime("%H:%M:%S")

        # Formatted console output with timestamp
        message = f"[{time_str}] {event}: {detail}"
        print(message)

        # Append to persistent log file
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(f"[{full_timestamp}] [{event}] {detail}\n")
        except OSError as err:
            logger.error("Failed to write to alert log: %s", err)

        # Forward genuine alert to Node.js backend
        self._dispatch_to_backend(event, detail, confidence=confidence, metadata=metadata)

        return True
