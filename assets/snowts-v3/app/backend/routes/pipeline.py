import threading
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from ..services.pipeline import get_pending_raw_files, get_raw_files, get_processed_files, run_pipeline, SUPPORTED_EXTENSIONS
from ..services.url_ingest import ingest_url
from ..services.watcher import is_watcher_running
from ..db import sf_execute, is_online, gen_id, RAW_DIR
from ..services.config import db_prefix
from datetime import datetime
from pathlib import Path

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

_active_run: dict | None = None
_active_thread: threading.Thread | None = None
_lock = threading.Lock()

@router.get("/raw-files")
async def raw_files():
    pending = get_pending_raw_files()
    processed = get_processed_files()
    return {"pending": pending, "processed": processed}

@router.post("/run")
async def trigger_pipeline():
    global _active_run
    with _lock:
        if _active_run and _active_run.get("status") == "running":
            started = _active_run.get("started_at", "")
            try:
                elapsed = (datetime.utcnow() - datetime.fromisoformat(started)).total_seconds()
                if elapsed < 300:
                    return _active_run
            except Exception:
                pass
            _active_run = None

    run_id = gen_id()
    started_at = datetime.utcnow().isoformat()
    run_stub = {
        "id": run_id, "pipeline_type": "raw_ingest", "status": "running",
        "files_processed": 0, "error_log": None,
        "started_at": started_at, "completed_at": None,
    }
    with _lock:
        _active_run = run_stub

    def _run_in_bg():
        global _active_run
        try:
            result = run_pipeline()
            with _lock:
                _active_run = result
        except Exception as e:
            with _lock:
                _active_run = {**run_stub, "status": "failed", "error_log": str(e),
                               "completed_at": datetime.utcnow().isoformat()}

    global _active_thread
    thread = threading.Thread(target=_run_in_bg, daemon=True)
    thread.start()
    with _lock:
        _active_thread = thread
    return run_stub

@router.get("/active")
async def active_run():
    global _active_run, _active_thread
    with _lock:
        if _active_run and _active_run.get("status") == "running":
            thread_dead = _active_thread is not None and not _active_thread.is_alive()
            started = _active_run.get("started_at", "")
            stale = False
            try:
                elapsed = (datetime.utcnow() - datetime.fromisoformat(started)).total_seconds()
                stale = elapsed > 300
            except Exception:
                stale = True
            if thread_dead or stale:
                _active_run = {**_active_run, "status": "failed",
                               "error_log": "Run expired (thread died or timeout)",
                               "completed_at": datetime.utcnow().isoformat()}
                _active_thread = None
                return _active_run
        if _active_run:
            return _active_run
    return {"status": "idle"}

@router.get("/status")
async def pipeline_status():
    if not is_online():
        return {"runs": []}
    try:
        runs = sf_execute(
            f"SELECT * FROM {db_prefix()}.PIPELINE_RUNS ORDER BY started_at DESC LIMIT 10"
        )
        return {"runs": runs}
    except Exception:
        return {"runs": []}


class IngestURLRequest(BaseModel):
    url: str


@router.post("/ingest-url")
async def ingest_url_endpoint(req: IngestURLRequest):
    try:
        result = ingest_url(req.url)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/upload-raw")
async def upload_raw_files(files: list[UploadFile] = File(...)):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    errors = []
    for f in files:
        if not f.filename:
            continue
        name = Path(f.filename).name
        ext = Path(name).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            errors.append({"file": name, "error": f"Unsupported type: {ext}"})
            continue
        dest = RAW_DIR / name
        counter = 1
        while dest.exists():
            stem = Path(name).stem
            dest = RAW_DIR / f"{stem}_{counter}{ext}"
            counter += 1
        try:
            content = await f.read()
            dest.write_bytes(content)
            saved.append({"file": dest.name, "size": len(content)})
        except Exception as e:
            errors.append({"file": name, "error": str(e)})
    return {"ok": True, "saved": saved, "errors": errors}


@router.get("/watcher-status")
async def watcher_status():
    return {"running": is_watcher_running()}
