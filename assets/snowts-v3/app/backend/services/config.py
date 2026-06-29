import json
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"

_DEFAULTS = {
    "setup_complete": False,
    "connection_name": None,
    "database": "SNOWTS_DB",
    "warehouse": "SNOWTS_WH",
}


def get_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return {**_DEFAULTS, **json.loads(CONFIG_PATH.read_text())}
        except Exception:
            pass
    return dict(_DEFAULTS)


def save_config(data: dict):
    existing = get_config()
    existing.update(data)
    CONFIG_PATH.write_text(json.dumps(existing, indent=2) + "\n")


def db_name() -> str:
    return get_config()["database"]


def db_prefix() -> str:
    return f"{db_name()}.APP"


def wh_name() -> str:
    return get_config()["warehouse"]


def is_setup_complete() -> bool:
    return get_config().get("setup_complete", False)


def mark_setup_complete(connection_name: str, database: str, warehouse: str):
    save_config({
        "setup_complete": True,
        "connection_name": connection_name,
        "database": database,
        "warehouse": warehouse,
    })
