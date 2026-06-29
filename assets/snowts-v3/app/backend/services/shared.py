from datetime import datetime, timedelta

from ..db import sf_execute, sf_execute_no_fetch, gen_id
from .config import db_prefix


def parse_due_date(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        datetime.fromisoformat(raw)
        return raw
    except (ValueError, TypeError):
        pass
    try:
        datetime.strptime(raw, "%Y-%m-%d")
        return raw
    except (ValueError, TypeError):
        pass
    today = datetime.utcnow()
    low = raw.lower().strip()
    day_map = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
    for prefix in ("next ", ""):
        for day_name, day_num in day_map.items():
            if low == prefix + day_name:
                days_ahead = day_num - today.weekday()
                if days_ahead <= 0:
                    days_ahead += 7
                if prefix == "next ":
                    days_ahead += 7
                result = today + timedelta(days=days_ahead)
                return result.strftime("%Y-%m-%d")
    if "tomorrow" in low:
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")
    return None


def upsert_client(name: str, classification: dict, contacts: list, article_id: str | None = None, now: str | None = None):
    now = now or datetime.utcnow().isoformat()
    existing = sf_execute(
        f"SELECT id FROM {db_prefix()}.CLIENTS WHERE LOWER(name) = LOWER(%s)", [name]
    )
    if existing:
        client_id = existing[0]["id"]
        sf_execute_no_fetch(
            f"UPDATE {db_prefix()}.CLIENTS SET last_contact = %s WHERE id = %s",
            [now[:10], client_id]
        )
    else:
        client_id = gen_id()
        sf_execute_no_fetch(f"""
            INSERT INTO {db_prefix()}.CLIENTS (id, name, industry, engagement_status, summary, last_contact, created_at)
            VALUES (%s, %s, %s, 'active', %s, %s, %s)
        """, [client_id, name, classification.get("industry", ""), classification.get("summary", ""), now[:10], now])

    upsert_contacts(client_id, contacts)
    return client_id


def upsert_contacts(client_id: str, contacts: list[dict]):
    for contact in contacts:
        name = (contact.get("name") or "").strip()
        if not name:
            continue
        existing = sf_execute(
            f"SELECT id FROM {db_prefix()}.CLIENT_CONTACTS WHERE client_id = %s AND LOWER(name) = LOWER(%s)",
            [client_id, name]
        )
        if not existing:
            sf_execute_no_fetch(f"""
                INSERT INTO {db_prefix()}.CLIENT_CONTACTS (id, client_id, name, role, email)
                VALUES (%s, %s, %s, %s, %s)
            """, [gen_id(), client_id, name, contact.get("role", ""), contact.get("email", "")])


def create_todo(todo: dict, source_article_id: str | None, client_name: str | None, tags: list[str] | None = None, *, confidence: str = "low", source: str = "ai"):
    client_id = None
    if client_name:
        rows = sf_execute(f"SELECT id FROM {db_prefix()}.CLIENTS WHERE LOWER(name) = LOWER(%s)", [client_name])
        if rows:
            client_id = rows[0]["id"]

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.TODOS (id, title, description, source_article_id, client_id, status, due_date, priority, created_at, tags_text, confidence, source)
        VALUES (%s, %s, %s, %s, %s, 'backlog', %s, %s, %s, %s, %s, %s)
    """, [
        gen_id(),
        todo.get("title", "Untitled TODO"),
        None,
        source_article_id,
        client_id,
        parse_due_date(todo.get("due_date")),
        todo.get("priority", "medium"),
        datetime.utcnow().isoformat(),
        ", ".join(tags) if tags else None,
        confidence,
        source,
    ])
