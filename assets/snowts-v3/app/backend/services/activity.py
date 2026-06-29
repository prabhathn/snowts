import asyncio
import json
import threading
from collections import deque
from datetime import datetime
from pathlib import Path

from ..db import gen_id

_STORE_PATH = Path(__file__).resolve().parent.parent / "activity_store.json"
_MAX_EVENTS = 500
_MAX_BATCHES = 50


class ActivityEvent:
    __slots__ = ("id", "type", "batch_id", "label", "detail", "status", "file_name", "timestamp")

    def __init__(
        self,
        event_type: str,
        label: str,
        detail: str = "",
        status: str = "info",
        file_name: str | None = None,
        batch_id: str | None = None,
    ):
        self.id = gen_id()
        self.type = event_type
        self.batch_id = batch_id
        self.label = label
        self.detail = detail
        self.status = status
        self.file_name = file_name
        self.timestamp = datetime.utcnow().isoformat()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "batch_id": self.batch_id,
            "label": self.label,
            "detail": self.detail,
            "status": self.status,
            "file_name": self.file_name,
            "timestamp": self.timestamp,
        }


_events: deque[dict] = deque(maxlen=_MAX_EVENTS)
_lock = threading.Lock()

_subscribers: list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = []
_sub_lock = threading.Lock()

_batches: dict[str, dict] = {}
_batch_lock = threading.Lock()


def _load_store():
    if not _STORE_PATH.exists():
        return
    try:
        data = json.loads(_STORE_PATH.read_text())
        for evt in reversed(data.get("events", [])):
            _events.appendleft(evt)
        for b in data.get("batches", []):
            _batches[b["id"]] = b
    except Exception:
        pass


def _flush_store():
    try:
        data = {
            "events": list(_events)[:_MAX_EVENTS],
            "batches": sorted(_batches.values(), key=lambda b: b["started_at"], reverse=True)[:_MAX_BATCHES],
        }
        _STORE_PATH.write_text(json.dumps(data, default=str))
    except Exception:
        pass


_load_store()


def _push_to_subscribers(d: dict):
    with _sub_lock:
        dead = []
        for q, loop in _subscribers:
            try:
                loop.call_soon_threadsafe(q.put_nowait, d)
            except Exception:
                dead.append((q, loop))
        for item in dead:
            try:
                _subscribers.remove(item)
            except ValueError:
                pass


def _push_batch_to_subscribers(batch: dict):
    _push_to_subscribers({"__type": "batch", **batch})


def emit(event: ActivityEvent):
    d = event.to_dict()
    with _lock:
        _events.appendleft(d)
        _flush_store()
    _push_to_subscribers(d)


def create_batch(batch_type: str, files: list[str]) -> str:
    batch_id = gen_id()
    batch = {
        "id": batch_id,
        "type": batch_type,
        "files": {f: "queued" for f in files},
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "status": "running",
    }
    with _batch_lock:
        _batches[batch_id] = batch
        _flush_store()

    _push_batch_to_subscribers(batch)

    emit(ActivityEvent(
        event_type="batch_start",
        label=f"Processing {len(files)} file{'s' if len(files) != 1 else ''}",
        detail=batch_type,
        status="running",
        batch_id=batch_id,
    ))

    for f in files:
        emit(ActivityEvent(
            event_type="file_status",
            label=f,
            detail="Queued for processing",
            status="queued",
            file_name=f,
            batch_id=batch_id,
        ))

    return batch_id


def update_file_status(batch_id: str, file_name: str, status: str, detail: str = ""):
    with _batch_lock:
        batch = _batches.get(batch_id)
        if batch:
            batch["files"][file_name] = status
            _flush_store()
            _push_batch_to_subscribers(dict(batch))

    emit(ActivityEvent(
        event_type="file_status",
        label=file_name,
        detail=detail,
        status=status,
        file_name=file_name,
        batch_id=batch_id,
    ))


def complete_batch(batch_id: str, status: str = "completed", detail: str = ""):
    with _batch_lock:
        batch = _batches.get(batch_id)
        if batch:
            batch["status"] = status
            batch["completed_at"] = datetime.utcnow().isoformat()
            _flush_store()
            _push_batch_to_subscribers(dict(batch))

    emit(ActivityEvent(
        event_type="batch_end",
        label=f"Batch {status}",
        detail=detail,
        status=status,
        batch_id=batch_id,
    ))


def emit_simple(event_type: str, label: str, detail: str = "", status: str = "info"):
    emit(ActivityEvent(
        event_type=event_type,
        label=label,
        detail=detail,
        status=status,
    ))


def get_history(limit: int = 100) -> list[dict]:
    with _lock:
        return list(_events)[:limit]


def get_batches() -> list[dict]:
    with _batch_lock:
        return sorted(_batches.values(), key=lambda b: b["started_at"], reverse=True)[:20]


def subscribe() -> asyncio.Queue:
    loop = asyncio.get_event_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    with _sub_lock:
        _subscribers.append((q, loop))
    return q


def unsubscribe(q: asyncio.Queue):
    with _sub_lock:
        _subscribers[:] = [(sq, sl) for sq, sl in _subscribers if sq is not q]
