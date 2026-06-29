import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..db import sf_execute, sf_execute_no_fetch, is_online, gen_id, NOTES_DIR
from ..models.schemas import ClientRenameRequest, ClientUpdateRequest
from ..services.config import db_prefix

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


@router.get("")
async def list_clients():
    if not is_online():
        return {"clients": []}
    try:
        clients = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS ORDER BY last_contact DESC NULLS LAST")
        return {"clients": clients}
    except Exception:
        return {"clients": []}


@router.patch("/{client_id}")
async def rename_client(client_id: str, body: ClientRenameRequest):
    if not is_online():
        raise HTTPException(503, "Snowflake offline")

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "Name cannot be empty")

    rows = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    if not rows:
        raise HTTPException(404, "Client not found")

    old_name = rows[0]["name"]
    if old_name == new_name:
        return {"ok": True, "client": rows[0]}

    old_slug = _slugify(old_name)
    new_slug = _slugify(new_name)

    sf_execute_no_fetch(
        f"UPDATE {db_prefix()}.CLIENTS SET NAME = %s WHERE ID = %s",
        [new_name, client_id],
    )

    old_file = NOTES_DIR / "clients" / f"{old_slug}.md"
    new_file = NOTES_DIR / "clients" / f"{new_slug}.md"
    old_path = f"notes/clients/{old_slug}.md"
    new_path = f"notes/clients/{new_slug}.md"

    if old_file.exists() and not new_file.exists():
        content = old_file.read_text(encoding="utf-8")
        content = content.replace(f"# {old_name}", f"# {new_name}", 1)
        new_file.write_text(content, encoding="utf-8")
        old_file.unlink()

    try:
        sf_execute_no_fetch(
            f"UPDATE {db_prefix()}.ARTICLES SET FILE_PATH = %s WHERE FILE_PATH = %s",
            [new_path, old_path],
        )
        sf_execute_no_fetch(
            f"UPDATE {db_prefix()}.ARTICLE_CONTENT SET CLIENT_NAME = %s WHERE LOWER(CLIENT_NAME) = LOWER(%s)",
            [new_name, old_name],
        )
    except Exception:
        pass

    updated = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    return {"ok": True, "client": updated[0] if updated else rows[0], "new_file_path": new_path}


class RenameByFileRequest(BaseModel):
    old_file: str
    new_name: str


@router.post("/rename-by-file")
async def rename_client_by_file(body: RenameByFileRequest):
    if not is_online():
        raise HTTPException(503, "Snowflake offline")

    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Name cannot be empty")

    old_file_path = body.old_file
    old_slug = old_file_path.split("/")[-1].replace(".md", "")
    new_slug = _slugify(new_name)
    new_file_path = f"notes/clients/{new_slug}.md"

    old_file = NOTES_DIR / "clients" / f"{old_slug}.md"
    new_file = NOTES_DIR / "clients" / f"{new_slug}.md"

    if old_file.exists() and not new_file.exists():
        content = old_file.read_text(encoding="utf-8")
        first_line = content.split("\n")[0] if content else ""
        if first_line.startswith("# "):
            content = f"# {new_name}\n" + "\n".join(content.split("\n")[1:])
        new_file.write_text(content, encoding="utf-8")
        old_file.unlink()

    try:
        sf_execute_no_fetch(
            f"UPDATE {db_prefix()}.ARTICLES SET FILE_PATH = %s WHERE FILE_PATH = %s",
            [new_file_path, old_file_path],
        )
    except Exception:
        pass

    try:
        rows = sf_execute(
            f"SELECT ac.client_name FROM {db_prefix()}.ARTICLE_CONTENT ac JOIN {db_prefix()}.ARTICLES a ON a.id = ac.article_id WHERE a.file_path = %s",
            [new_file_path],
        )
        if rows:
            old_client_name = rows[0]["client_name"]
            sf_execute_no_fetch(
                f"UPDATE {db_prefix()}.ARTICLE_CONTENT SET CLIENT_NAME = %s WHERE LOWER(CLIENT_NAME) = LOWER(%s)",
                [new_name, old_client_name],
            )
    except Exception:
        pass

    client_id = None
    try:
        crows = sf_execute(f"SELECT id FROM {db_prefix()}.CLIENTS WHERE LOWER(name) = LOWER(%s)", [new_name])
        if crows:
            client_id = crows[0]["id"]
        else:
            client_id = gen_id()
            now = datetime.utcnow().isoformat()
            sf_execute_no_fetch(
                f"INSERT INTO {db_prefix()}.CLIENTS (id, name, industry, engagement_status, summary, created_at) VALUES (%s, %s, '', 'active', '', %s)",
                [client_id, new_name, now],
            )
    except Exception:
        pass

    return {"ok": True, "new_file_path": new_file_path, "client_id": client_id}


@router.get("/{client_id}")
async def get_client(client_id: str):
    if not is_online():
        raise HTTPException(503, "Snowflake offline")

    clients = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    if not clients:
        raise HTTPException(404, "Client not found")

    contacts = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENT_CONTACTS WHERE client_id = %s", [client_id])

    articles = sf_execute(f"""
        SELECT a.* FROM {db_prefix()}.ARTICLES a
        JOIN {db_prefix()}.ARTICLE_CONTENT ac ON a.id = ac.article_id
        WHERE LOWER(ac.client_name) = LOWER(%s)
        ORDER BY a.updated_at DESC
    """, [clients[0]["name"]])

    todos = sf_execute(
        f"SELECT * FROM {db_prefix()}.TODOS WHERE client_id = %s AND archived_at IS NULL AND rejected_at IS NULL AND status != 'done' ORDER BY created_at DESC",
        [client_id]
    )

    return {
        "client": clients[0],
        "contacts": contacts,
        "articles": articles,
        "todos": todos,
    }


@router.put("/{client_id}")
async def update_client(client_id: str, body: ClientUpdateRequest):
    if not is_online():
        raise HTTPException(503, "Snowflake offline")

    rows = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    if not rows:
        raise HTTPException(404, "Client not found")

    updates = []
    params = []
    if body.name is not None and body.name.strip():
        updates.append("NAME = %s")
        params.append(body.name.strip())
    if body.industry is not None:
        updates.append("INDUSTRY = %s")
        params.append(body.industry.strip())
    if body.engagement_status is not None:
        updates.append("ENGAGEMENT_STATUS = %s")
        params.append(body.engagement_status.strip())
    if body.summary is not None:
        updates.append("SUMMARY = %s")
        params.append(body.summary.strip())

    if not updates:
        return {"ok": True, "client": rows[0]}

    params.append(client_id)
    sf_execute_no_fetch(
        f"UPDATE {db_prefix()}.CLIENTS SET {', '.join(updates)} WHERE ID = %s",
        params,
    )

    if body.name and body.name.strip() != rows[0]["name"]:
        old_name = rows[0]["name"]
        new_name = body.name.strip()
        old_slug = _slugify(old_name)
        new_slug = _slugify(new_name)
        old_file = NOTES_DIR / "clients" / f"{old_slug}.md"
        new_file = NOTES_DIR / "clients" / f"{new_slug}.md"
        old_path = f"notes/clients/{old_slug}.md"
        new_path = f"notes/clients/{new_slug}.md"
        if old_file.exists() and not new_file.exists():
            content = old_file.read_text(encoding="utf-8")
            content = content.replace(f"# {old_name}", f"# {new_name}", 1)
            new_file.write_text(content, encoding="utf-8")
            old_file.unlink()
        try:
            sf_execute_no_fetch(
                f"UPDATE {db_prefix()}.ARTICLES SET FILE_PATH = %s WHERE FILE_PATH = %s",
                [new_path, old_path],
            )
            sf_execute_no_fetch(
                f"UPDATE {db_prefix()}.ARTICLE_CONTENT SET CLIENT_NAME = %s WHERE LOWER(CLIENT_NAME) = LOWER(%s)",
                [new_name, old_name],
            )
        except Exception:
            pass

    updated = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    return {"ok": True, "client": updated[0] if updated else rows[0]}


@router.delete("/{client_id}")
async def delete_client(client_id: str):
    if not is_online():
        raise HTTPException(503, "Snowflake offline")

    rows = sf_execute(f"SELECT * FROM {db_prefix()}.CLIENTS WHERE id = %s", [client_id])
    if not rows:
        raise HTTPException(404, "Client not found")

    client_name = rows[0]["name"]
    client_slug = _slugify(client_name)

    try:
        sf_execute_no_fetch(f"DELETE FROM {db_prefix()}.CLIENT_CONTACTS WHERE CLIENT_ID = %s", [client_id])
    except Exception:
        pass
    try:
        sf_execute_no_fetch(f"UPDATE {db_prefix()}.TODOS SET CLIENT_ID = NULL WHERE CLIENT_ID = %s", [client_id])
    except Exception:
        pass

    sf_execute_no_fetch(f"DELETE FROM {db_prefix()}.CLIENTS WHERE ID = %s", [client_id])

    client_file = NOTES_DIR / "clients" / f"{client_slug}.md"
    if client_file.exists():
        client_file.unlink()

    return {"ok": True}
