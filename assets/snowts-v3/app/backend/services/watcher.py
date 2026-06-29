import logging
import os
import threading
import time
from pathlib import Path

from ..db import RAW_DIR

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".md", ".txt", ".html", ".docx", ".pdf"}
DEBOUNCE_SECONDS = 5

_watcher_thread: threading.Thread | None = None
_stop_event = threading.Event()
_pending_callback = None


def _poll_loop(callback):
    seen = set()
    if RAW_DIR.exists():
        for f in RAW_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."):
                seen.add(f.name)

    batch: list[str] = []
    last_change = 0.0

    while not _stop_event.is_set():
        try:
            if RAW_DIR.exists():
                current = set()
                for f in RAW_DIR.iterdir():
                    if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith("."):
                        current.add(f.name)

                new_files = current - seen
                if new_files:
                    for nf in new_files:
                        if nf not in batch:
                            batch.append(nf)
                    last_change = time.time()
                    seen.update(new_files)

            if batch and (time.time() - last_change) >= DEBOUNCE_SECONDS:
                logger.info("Watcher detected %d new file(s): %s", len(batch), batch)
                try:
                    callback(batch[:])
                except Exception:
                    logger.exception("Watcher pipeline callback failed")
                batch.clear()

        except Exception:
            logger.exception("Watcher poll error")

        _stop_event.wait(timeout=2)


def start_watcher(callback):
    global _watcher_thread, _pending_callback
    if not os.environ.get("SNOWTS_WATCH", "").strip():
        logger.info("File watcher disabled (set SNOWTS_WATCH=1 to enable)")
        return

    if _watcher_thread and _watcher_thread.is_alive():
        logger.info("File watcher already running")
        return

    _stop_event.clear()
    _pending_callback = callback
    _watcher_thread = threading.Thread(target=_poll_loop, args=(callback,), daemon=True)
    _watcher_thread.start()
    logger.info("File watcher started on %s", RAW_DIR)


def stop_watcher():
    _stop_event.set()
    if _watcher_thread:
        _watcher_thread.join(timeout=5)
    logger.info("File watcher stopped")


def is_watcher_running() -> bool:
    return _watcher_thread is not None and _watcher_thread.is_alive()
