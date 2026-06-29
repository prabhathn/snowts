import logging
import threading
import queue
import re as _re
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from ..db import (
    sf_execute, sf_execute_no_fetch, is_online, gen_id, queue_offline,
    NOTES_DIR,
)
from .ai import classify_note, process_daily_note, process_annotation
from .shared import parse_due_date, upsert_contacts, upsert_client, create_todo
from . import activity
from .config import db_prefix

_note_queue: queue.Queue = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()

_inbox_log: list[dict] = []
_inbox_log_lock = threading.Lock()

INBOX_PATH = NOTES_DIR / "inbox.md"

_TODO_PATTERN = _re.compile(r'#TODO\s*[-:]?\s*(.+)', _re.IGNORECASE)


def _extract_manual_todos(text: str) -> list[dict]:
    todos = []
    for line in text.split('\n'):
        m = _TODO_PATTERN.search(line.strip())
        if m:
            title = m.group(1).strip().rstrip('.!').strip()
            if title and len(title) > 3:
                todos.append({"title": title, "priority": "high"})
    return todos


def _ensure_worker():
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
        t = threading.Thread(target=_bg_worker, daemon=True)
        t.start()


def _bg_worker():
    while True:
        item = _note_queue.get()
        try:
            _process_note_async(item)
        except Exception:
            pass
        finally:
            _note_queue.task_done()


def _process_note_async(item: dict):
    text = item["text"]
    daily_path = item["daily_path"]
    timestamp = item["timestamp"]

    classification = classify_note(text)

    client = classification.get("client")
    tags = classification.get("tags", [])
    route = classification.get("route", "daily")

    if route == "client" and client:
        slug = client.lower().replace(" ", "-").replace("/", "-")
        target_path = NOTES_DIR / "clients" / f"{slug}.md"
    elif route == "topic" and tags:
        slug = tags[0].lower().replace(" ", "-")
        target_path = NOTES_DIR / "topics" / f"{slug}.md"
    else:
        target_path = None

    if target_path and target_path != daily_path:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        time_str = datetime.fromisoformat(timestamp).strftime("%H:%M")
        entry = f"\n---\n### {time_str}\n\n{text}\n"

        if not target_path.exists():
            header = ""
            if route == "client" and client:
                header = f"# {client} Notes\n"
            elif route == "topic" and tags:
                header = f"# {tags[0].title()}\n"
            target_path.write_text(header + entry, encoding="utf-8")
        else:
            with open(target_path, "a", encoding="utf-8") as f:
                f.write(entry)

    index_path = str((target_path or daily_path).relative_to(NOTES_DIR.parent))

    if is_online() and route == "client" and client:
        try:
            upsert_client(client, {"industry": "", "summary": ""}, [])
        except Exception:
            pass

    if is_online():
        try:
            _index_note(text, index_path, client, tags)
        except Exception:
            queue_offline("index_note", {"text": text, "file_path": index_path, "client": client, "tags": tags})
    else:
        queue_offline("index_note", {"text": text, "file_path": index_path, "client": client, "tags": tags})

    for todo in classification.get("todos", []):
        if is_online():
            try:
                create_todo(todo, None, client, tags, confidence="low", source="ai-quicknote")
            except Exception:
                queue_offline("create_todo", {"todo": todo, "client": client, "source_path": index_path})
        else:
            queue_offline("create_todo", {"todo": todo, "client": client, "source_path": index_path})

    for todo in _extract_manual_todos(text):
        if is_online():
            try:
                create_todo(todo, None, client, tags, confidence="high", source="manual")
            except Exception:
                queue_offline("create_todo", {"todo": todo, "client": client, "source_path": index_path})
        else:
            queue_offline("create_todo", {"todo": todo, "client": client, "source_path": index_path})


def get_inbox() -> dict:
    if not INBOX_PATH.exists():
        return {"content": "", "metadata": {"id": "inbox", "title": "Inbox", "file_path": "notes/inbox.md"}}
    content = INBOX_PATH.read_text(encoding="utf-8", errors="replace")
    return {
        "content": content,
        "metadata": {"id": "inbox", "title": "Inbox", "file_path": "notes/inbox.md"},
    }


def save_inbox(content: str) -> bool:
    INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INBOX_PATH.write_text(content, encoding="utf-8")
    return True


def process_inbox() -> dict:
    if not INBOX_PATH.exists():
        return {"ok": False, "error": "Inbox is empty"}

    content = INBOX_PATH.read_text(encoding="utf-8", errors="replace")
    raw_md = _re.sub(r'<[^>]+>', '', content).strip()

    if not raw_md:
        return {"ok": True, "id": None}

    today = datetime.utcnow().strftime("%Y-%m-%d")
    now_time = datetime.utcnow().strftime("%H:%M")
    now_iso = datetime.utcnow().isoformat()

    daily_path = NOTES_DIR / "daily" / f"{today}.md"
    daily_path.parent.mkdir(parents=True, exist_ok=True)
    raw_entry = f'\n---\n### {now_time}\n\n{raw_md}\n'
    if not daily_path.exists():
        header = f'# {datetime.utcnow().strftime("%B %d, %Y")}\n'
        daily_path.write_text(header + raw_entry, encoding="utf-8")
    else:
        with open(daily_path, "a", encoding="utf-8") as f:
            f.write(raw_entry)

    INBOX_PATH.write_text("", encoding="utf-8")

    log_id = gen_id()
    flat = _re.sub(r'\s+', ' ', raw_md).strip()
    preview = flat[:120] + ("..." if len(flat) > 120 else "")
    log_entry = {
        "id": log_id,
        "timestamp": now_iso,
        "preview": preview,
        "status": "processing",
        "classification": None,
        "routed": None,
        "error": None,
    }
    with _inbox_log_lock:
        _inbox_log.insert(0, log_entry)
        if len(_inbox_log) > 50:
            _inbox_log[:] = _inbox_log[:50]

    activity.emit_simple("inbox_process", "Processing inbox", preview, "running")

    t = threading.Thread(
        target=_process_inbox_bg,
        args=(log_id, raw_md, today, now_time, daily_path),
        daemon=True,
    )
    t.start()

    return {"ok": True, "id": log_id}


def get_inbox_log() -> list[dict]:
    with _inbox_log_lock:
        return list(_inbox_log)


def _build_section_entry(section: dict, date_label: str) -> str:
    summary = section.get("summary", "")
    key_points = section.get("key_points", [])
    contacts = section.get("contacts", [])
    tags = section.get("tags", [])

    parts = [f'---\n### {date_label}']
    if summary:
        parts.append(f'\n{summary}')
    if key_points:
        parts.append('')
        for pt in key_points:
            parts.append(f'- {pt}')
    if contacts:
        contact_strs = []
        for c in contacts:
            name = c.get("name", "")
            role = c.get("role")
            contact_strs.append(f"{name} ({role})" if role else name)
        parts.append(f'\n**People:** {", ".join(contact_strs)}')
    if tags:
        parts.append(f'\n**Tags:** {", ".join(tags)}')
    return "\n".join(parts)


def _route_sections(result: dict, date_label: str, source_path: str, *, dedup_dates: bool = False) -> list[dict]:
    routed: list[dict] = []

    for section in result.get("sections", []):
        client = section.get("client")
        if not client:
            continue

        slug = client.lower().replace(" ", "-").replace("/", "-")
        target_path = NOTES_DIR / "clients" / f"{slug}.md"
        target_path.parent.mkdir(parents=True, exist_ok=True)

        entry = _build_section_entry(section, date_label)

        if not target_path.exists():
            target_path.write_text(f'# {client}\n\n{entry}', encoding="utf-8")
        elif dedup_dates:
            existing_content = target_path.read_text(encoding="utf-8", errors="replace")
            if f"### {date_label}" not in existing_content:
                with open(target_path, "a", encoding="utf-8") as f:
                    f.write("\n\n" + entry)
        else:
            with open(target_path, "a", encoding="utf-8") as f:
                f.write("\n\n" + entry)

        routed_entry = {"client": client, "file": f"notes/clients/{slug}.md"}
        if is_online():
            try:
                client_id = upsert_client(client, {"industry": "", "summary": summary}, contacts)
                routed_entry["client_id"] = client_id
            except Exception:
                pass
        routed.append(routed_entry)

        client_path = str(target_path.relative_to(NOTES_DIR.parent))
        if is_online():
            try:
                _index_note(f"{summary} {' '.join(key_points)}"[:4000], client_path, client, tags)
            except Exception:
                pass

    for section in result.get("sections", []):
        if section.get("client"):
            continue
        tags = section.get("tags", [])
        if not tags:
            continue
        slug = tags[0].lower().replace(" ", "-").replace("/", "-")
        target_path = NOTES_DIR / "topics" / f"{slug}.md"
        target_path.parent.mkdir(parents=True, exist_ok=True)

        entry = _build_section_entry(section, date_label)

        if not target_path.exists():
            target_path.write_text(f'# {tags[0].title()}\n\n{entry}', encoding="utf-8")
        else:
            with open(target_path, "a", encoding="utf-8") as f:
                f.write("\n\n" + entry)

        routed.append({"topic": tags[0], "file": f"notes/topics/{slug}.md"})

    for todo in result.get("todos", []):
        todo_client = todo.get("client")
        if is_online():
            try:
                existing_todo = sf_execute(
                    f"SELECT id FROM {db_prefix()}.TODOS WHERE LOWER(title) = LOWER(%s)",
                    [todo.get("title", "")]
                )
                if not existing_todo:
                    create_todo(todo, None, todo_client, result.get("tags", []), confidence="low", source="ai-inbox")
            except Exception:
                queue_offline("create_todo", {"todo": todo, "client": todo_client, "source_path": source_path})

    return routed


def _process_inbox_bg(log_id: str, text: str, today: str, now_time: str, daily_path: Path):
    try:
        result = process_daily_note(text[:12000], today)
        logger.info("process_inbox AI result: sections=%d, todos=%d, tags=%d",
                     len(result.get('sections', [])), len(result.get('todos', [])), len(result.get('tags', [])))

        daily_rel = str(daily_path.relative_to(NOTES_DIR.parent))
        routed = _route_sections(result, f"{today} {now_time}", daily_rel)

        for todo in _extract_manual_todos(text):
            if is_online():
                try:
                    create_todo(todo, None, None, result.get("tags", []), confidence="high", source="manual")
                except Exception:
                    pass

        if is_online():
            try:
                _index_note(text[:4000], daily_rel, None, result.get("tags", []))
            except Exception:
                pass

        with _inbox_log_lock:
            for entry in _inbox_log:
                if entry["id"] == log_id:
                    entry["status"] = "done"
                    entry["classification"] = result
                    entry["routed"] = routed
                    break

        sections = len(result.get("sections", []))
        todos = len(result.get("todos", []))
        activity.emit_simple("inbox_process", "Inbox processed", f"{sections} sections, {todos} todos", "done")

    except Exception as e:
        logger.exception("Inbox processing failed for %s", log_id)
        with _inbox_log_lock:
            for entry in _inbox_log:
                if entry["id"] == log_id:
                    entry["status"] = "error"
                    entry["error"] = str(e)
                    break
        activity.emit_simple("inbox_process", "Inbox processing failed", str(e), "error")


def submit_quick_note(text: str) -> dict:
    _ensure_worker()

    timestamp = datetime.utcnow().isoformat()
    today = datetime.utcnow().strftime("%Y-%m-%d")
    daily_path = NOTES_DIR / "daily" / f"{today}.md"
    daily_path.parent.mkdir(parents=True, exist_ok=True)

    time_str = datetime.utcnow().strftime("%H:%M")
    entry = f"\n### {time_str}\n{text}\n"

    if not daily_path.exists():
        header = f"# {datetime.utcnow().strftime('%B %d, %Y')}\n"
        daily_path.write_text(header + entry, encoding="utf-8")
    else:
        with open(daily_path, "a", encoding="utf-8") as f:
            f.write(entry)

    rel_path = str(daily_path.relative_to(NOTES_DIR.parent))

    preview = text[:80] + ("..." if len(text) > 80 else "")
    activity.emit_simple("quick_note", "Quick note saved", preview, "done")

    _note_queue.put({"text": text, "daily_path": daily_path, "timestamp": timestamp})

    return {
        "text": text,
        "timestamp": timestamp,
        "file_path": rel_path,
        "client": None,
        "tags": [],
    }


def list_notes() -> list[dict]:
    notes = []
    for subdir in ["daily", "clients", "topics"]:
        d = NOTES_DIR / subdir
        if not d.exists():
            continue
        for f in sorted(d.iterdir(), reverse=True):
            if f.is_file() and f.suffix == ".md":
                notes.append({
                    "id": str(f.relative_to(NOTES_DIR.parent)),
                    "title": f.stem.replace("-", " ").title(),
                    "slug": f.stem,
                    "file_path": str(f.relative_to(NOTES_DIR.parent)),
                    "summary": "",
                    "source_type": "note",
                    "created_at": datetime.fromtimestamp(f.stat().st_ctime).isoformat(),
                    "updated_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                })
    return notes


def get_note(path: str) -> dict:
    full_path = NOTES_DIR.parent / path
    if not full_path.exists() or not full_path.is_file():
        return {"content": "", "metadata": {}}
    content = full_path.read_text(encoding="utf-8", errors="replace")
    return {
        "content": content,
        "metadata": {
            "id": path,
            "title": full_path.stem.replace("-", " ").title(),
            "slug": full_path.stem,
            "file_path": path,
            "summary": "",
            "source_type": "note",
            "created_at": datetime.fromtimestamp(full_path.stat().st_ctime).isoformat(),
            "updated_at": datetime.fromtimestamp(full_path.stat().st_mtime).isoformat(),
        },
    }


def process_note(path: str) -> dict:
    full_path = NOTES_DIR.parent / path
    if not full_path.exists():
        return {"ok": False, "error": "not found"}

    content = full_path.read_text(encoding="utf-8", errors="replace")
    text = _re.sub(r'<[^>]+>', ' ', content)
    text = _re.sub(r'\s+', ' ', text).strip()

    if not text:
        return {"ok": True, "classification": {"sections": [], "todos": [], "tags": []}, "routed": []}

    date_str = Path(path).stem
    result = process_daily_note(text[:12000], date_str)

    routed = _route_sections(result, date_str, path, dedup_dates=True)

    if is_online():
        try:
            _index_note(text[:4000], path, None, result.get("tags", []))
        except Exception:
            pass

    return {"ok": True, "classification": result, "routed": routed}


def save_note(path: str, content: str) -> bool:
    full_path = NOTES_DIR.parent / path
    if not full_path.exists():
        return False

    if is_online():
        try:
            old_content = full_path.read_text(encoding="utf-8", errors="replace")
            existing = sf_execute(
                f"SELECT id FROM {db_prefix()}.ARTICLES WHERE file_path = %s", [path]
            )
            if existing:
                sf_execute_no_fetch(f"""
                    INSERT INTO {db_prefix()}.ARTICLE_REVISIONS (id, article_id, content_snapshot, change_reason, created_at)
                    VALUES (%s, %s, %s, 'Manual edit', %s)
                """, [gen_id(), existing[0]["id"], old_content, datetime.utcnow().isoformat()])
        except Exception:
            pass

    full_path.write_text(content, encoding="utf-8")
    return True


def get_recent_notes(limit: int = 10) -> list[dict]:
    entries = []
    for subdir in ["daily", "clients", "topics"]:
        d = NOTES_DIR / subdir
        if not d.exists():
            continue
        for f in d.iterdir():
            if not f.is_file() or f.suffix != ".md":
                continue
            try:
                content = f.read_text(encoding="utf-8", errors="replace")
                for line in reversed(content.split("\n")):
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and stripped != "---" and not stripped.startswith("- "):
                        clean = _re.sub(r'<[^>]+>', '', stripped)
                        clean = _re.sub(r'\*\*|__|\*|_|`', '', clean).strip()
                        if clean:
                            entries.append({
                                "text": clean[:200],
                                "timestamp": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                                "file_path": str(f.relative_to(NOTES_DIR.parent)),
                                "client": None,
                                "tags": [],
                            })
                            break
            except Exception:
                continue

    entries.sort(key=lambda x: x["timestamp"], reverse=True)
    return entries[:limit]


def annotate_note(path: str, annotation: str) -> dict:
    full_path = NOTES_DIR.parent / path
    if not full_path.exists():
        return {"ok": False, "error": "not found"}

    content = full_path.read_text(encoding="utf-8", errors="replace")
    if not content.strip():
        return {"ok": False, "error": "Note is empty"}

    result = process_annotation(content, annotation)

    merged = result.get("merged", content)
    summary = result.get("summary", "")

    if is_online():
        try:
            old_content = content
            existing = sf_execute(
                f"SELECT id FROM {db_prefix()}.ARTICLES WHERE file_path = %s", [path]
            )
            article_id = existing[0]["id"] if existing else None
            if article_id:
                sf_execute_no_fetch(f"""
                    INSERT INTO {db_prefix()}.ARTICLE_REVISIONS (id, article_id, content_snapshot, change_reason, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                """, [gen_id(), article_id, old_content, f"Pre-annotation snapshot", datetime.utcnow().isoformat()])

            sf_execute_no_fetch(f"""
                INSERT INTO {db_prefix()}.ANNOTATIONS (id, article_id, highlighted_text, instruction, ai_response, status, created_at, processed_at)
                VALUES (%s, %s, NULL, %s, %s, 'processed', %s, %s)
            """, [gen_id(), article_id, annotation, summary, datetime.utcnow().isoformat(), datetime.utcnow().isoformat()])
        except Exception:
            pass

    full_path.write_text(merged, encoding="utf-8")

    return {"ok": True, "merged": merged, "summary": summary}


def _index_note(text: str, file_path: str, client: str | None, tags: list[str]):
    existing = sf_execute(
        f"SELECT id FROM {db_prefix()}.ARTICLES WHERE file_path = %s", [file_path]
    )
    now = datetime.utcnow().isoformat()

    if existing:
        article_id = existing[0]["id"]
        sf_execute_no_fetch(
            f"UPDATE {db_prefix()}.ARTICLES SET updated_at = %s WHERE id = %s",
            [now, article_id]
        )
        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.ARTICLE_CONTENT SET content = content || '\n' || %s WHERE article_id = %s
        """, [text, article_id])
    else:
        article_id = gen_id()
        title = Path(file_path).stem.replace("-", " ").title()
        sf_execute_no_fetch(f"""
            INSERT INTO {db_prefix()}.ARTICLES (id, title, slug, file_path, content_hash, summary, source_type, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, '', 'note', %s, %s)
        """, [article_id, title, Path(file_path).stem, file_path, "", now, now])

        sf_execute_no_fetch(f"""
            INSERT INTO {db_prefix()}.ARTICLE_CONTENT (id, article_id, title, content, source_type, client_name, tags_text)
            VALUES (%s, %s, %s, %s, 'note', %s, %s)
        """, [gen_id(), article_id, title, text, client, ", ".join(tags)])


