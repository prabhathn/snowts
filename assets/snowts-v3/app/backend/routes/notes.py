import re
import threading
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pathlib import Path
from ..models.schemas import QuickNoteRequest, SaveNoteRequest, AnnotateRequest, NoteEntry
from ..services.notes import (
    submit_quick_note, list_notes, get_note, save_note, get_recent_notes,
    process_note, get_inbox, save_inbox, process_inbox, get_inbox_log, annotate_note,
)
from ..services.url_ingest import ingest_url
from ..services.pipeline import run_pipeline, SUPPORTED_EXTENSIONS
from ..services import activity
from ..db import RAW_DIR

router = APIRouter(prefix="/api/notes", tags=["notes"])

_URL_RE = re.compile(r'^https?://\S+$')


def _auto_trigger_pipeline():
    try:
        run_pipeline()
    except Exception:
        pass


@router.post("/smart")
async def smart_input(
    text: Optional[str] = Form(None),
    files: list[UploadFile] = File(None),
):
    results: dict = {"type": None, "note": None, "url": None, "files": []}

    if text and text.strip() and _URL_RE.match(text.strip()):
        url = text.strip()
        try:
            ing = ingest_url(url)
            results["type"] = "url"
            results["url"] = {"ok": True, "filename": ing["filename"], "title": ing["title"], "url": url}
            threading.Thread(target=_auto_trigger_pipeline, daemon=True).start()
        except Exception as e:
            note_entry = submit_quick_note(text.strip())
            results["type"] = "note"
            results["note"] = note_entry
            results["url"] = {"ok": False, "error": str(e)}
    elif text and text.strip():
        note_entry = submit_quick_note(text.strip())
        results["type"] = "note"
        results["note"] = note_entry

    if files:
        saved = []
        errors = []
        RAW_DIR.mkdir(parents=True, exist_ok=True)
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

        results["files"] = saved
        if not results["type"]:
            results["type"] = "file"
        if saved:
            activity.emit_simple("file_upload", f"{len(saved)} file{'s' if len(saved) != 1 else ''} uploaded", ", ".join(s["file"] for s in saved), "done")
            threading.Thread(target=_auto_trigger_pipeline, daemon=True).start()

    if not results["type"]:
        results["type"] = "empty"

    return results

@router.post("/quick", response_model=NoteEntry)
async def quick_note(req: QuickNoteRequest):
    return submit_quick_note(req.text)

@router.get("/inbox")
async def read_inbox():
    return get_inbox()

@router.put("/inbox")
async def write_inbox(req: SaveNoteRequest):
    save_inbox(req.content)
    return {"ok": True}

@router.post("/inbox/process")
async def process_inbox_route():
    result = process_inbox()
    if not result["ok"]:
        raise HTTPException(400, result.get("error", "Failed"))
    return result

@router.get("/inbox/log")
async def inbox_log_route():
    return {"entries": get_inbox_log()}

@router.get("")
async def get_notes():
    return {"notes": list_notes()}

@router.get("/recent")
async def recent(limit: int = 10):
    return {"entries": get_recent_notes(limit)}

@router.get("/{path:path}")
async def read_note(path: str):
    result = get_note(path)
    if not result["metadata"]:
        raise HTTPException(404, "Note not found")
    return result

@router.put("/{path:path}")
async def write_note(path: str, req: SaveNoteRequest):
    ok = save_note(path, req.content)
    if not ok:
        raise HTTPException(404, "Note not found")
    return {"ok": True}

@router.post("/{path:path}/process")
async def process_note_route(path: str):
    result = process_note(path)
    if not result["ok"]:
        raise HTTPException(404, result.get("error", "Failed"))
    return result

@router.post("/{path:path}/annotate")
async def annotate_note_route(path: str, req: AnnotateRequest):
    result = annotate_note(path, req.annotation)
    if not result["ok"]:
        raise HTTPException(400, result.get("error", "Failed"))
    return result
