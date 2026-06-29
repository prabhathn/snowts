import os
import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path

import snowflake.connector

BASE_DIR = Path(__file__).resolve().parent.parent.parent
NOTES_DIR = BASE_DIR / "notes"
RAW_DIR = BASE_DIR / "raw"
WIKI_DIR = BASE_DIR / "wiki"
OFFLINE_DB = Path(__file__).resolve().parent / "offline_queue.db"

_sf_conn = None
_connection_name: str | None = None


def get_connection_name() -> str:
    return _connection_name or os.getenv("SNOWFLAKE_CONNECTION_NAME", "default")


def set_connection_name(name: str):
    global _sf_conn, _connection_name
    _connection_name = name
    if _sf_conn is not None:
        try:
            _sf_conn.close()
        except Exception:
            pass
        _sf_conn = None


def get_temp_connection(name: str):
    return snowflake.connector.connect(connection_name=name)


def get_snowflake_conn():
    global _sf_conn
    if _sf_conn is not None:
        try:
            _sf_conn.cursor().execute("SELECT 1")
            return _sf_conn
        except Exception:
            _sf_conn = None
    try:
        _sf_conn = snowflake.connector.connect(connection_name=get_connection_name())
        return _sf_conn
    except Exception:
        return None

def is_online():
    return get_snowflake_conn() is not None

def sf_execute(sql, params=None):
    conn = get_snowflake_conn()
    if conn is None:
        raise ConnectionError("Snowflake not available")
    cur = conn.cursor()
    cur.execute(sql, params or [])
    cols = [d[0].lower() for d in cur.description] if cur.description else []
    return [dict(zip(cols, row)) for row in cur.fetchall()]

def sf_execute_no_fetch(sql, params=None):
    conn = get_snowflake_conn()
    if conn is None:
        raise ConnectionError("Snowflake not available")
    cur = conn.cursor()
    cur.execute(sql, params or [])

def _init_offline_db():
    conn = sqlite3.connect(str(OFFLINE_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS queue (
            id TEXT PRIMARY KEY,
            action_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

_init_offline_db()

def queue_offline(action_type: str, payload: dict):
    conn = sqlite3.connect(str(OFFLINE_DB))
    conn.execute(
        "INSERT INTO queue (id, action_type, payload, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
        (str(uuid.uuid4()), action_type, json.dumps(payload), datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

def get_pending_offline():
    conn = sqlite3.connect(str(OFFLINE_DB))
    rows = conn.execute("SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at").fetchall()
    conn.close()
    return [{"id": r[0], "action_type": r[1], "payload": json.loads(r[2]), "status": r[3], "created_at": r[4]} for r in rows]

def gen_id():
    return str(uuid.uuid4())[:12]
