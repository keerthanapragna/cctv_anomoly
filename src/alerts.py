import time
import logging
from pathlib import Path
from typing import Optional
import src.config as cfg

logger = logging.getLogger(__name__)


class AlertManager:
    """Handles rate-limiting, logging, and dispatching of safety alerts."""

    def __init__(self, cooldown: float = cfg.ALERT_COOLDOWN, log_file: Path = cfg.ALERT_LOG_FILE):
        self.cooldown = cooldown
        self.log_file = Path(log_file)
        self.last_alert = {}
        self._ensure_log_file()

    def _ensure_log_file(self):
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def trigger(self, event: str, detail: str, key_override: Optional[str] = None) -> bool:
        """
        Triggers an alert if cooldown period has elapsed.
        Returns:
            bool: True if alert was fired, False if throttled.
        """
        now = time.time()
        # Allows cooldown per specific track or event
        key = key_override if key_override is not None else event

        if now - self.last_alert.get(key, 0.0) < self.cooldown:
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

        return True
