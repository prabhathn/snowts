from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import (
    get_snowflake_conn, get_connection_name, set_connection_name,
    get_temp_connection, BASE_DIR,
)
from ..services.setup import (
    list_connections, get_setup_status, run_setup,
    get_migration_preflight, run_migration, copy_local_files,
    rebuild_search_service, test_connection,
)
from ..services.config import save_config, mark_setup_complete, is_setup_complete

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SwitchConnectionRequest(BaseModel):
    name: str


class MigrateRequest(BaseModel):
    source: str
    target: str


class SetupWithConfigRequest(BaseModel):
    connection_name: str
    database: str = "SNOWTS_DB"
    warehouse: str = "SNOWTS_WH"


@router.get("/connections")
async def connections():
    return {"connections": list_connections(), "current": get_connection_name()}


@router.post("/connection")
async def switch_connection(body: SwitchConnectionRequest):
    set_connection_name(body.name)
    conn = get_snowflake_conn()
    if conn is None:
        raise HTTPException(400, f"Could not connect with '{body.name}'")
    return {"ok": True, "connection": body.name}


@router.get("/setup-complete")
async def setup_complete_check():
    return {"setup_complete": is_setup_complete()}


@router.post("/test-connection")
async def test_connection_route(body: SwitchConnectionRequest):
    result = test_connection(body.name)
    return result


@router.post("/setup-with-config")
async def setup_with_config(body: SetupWithConfigRequest):
    save_config({
        "connection_name": body.connection_name,
        "database": body.database,
        "warehouse": body.warehouse,
    })
    set_connection_name(body.connection_name)
    conn = get_snowflake_conn()
    if conn is None:
        raise HTTPException(503, f"Could not connect with '{body.connection_name}'")
    results = run_setup(conn)
    failed = [r for r in results if not r["success"]]
    if not failed:
        mark_setup_complete(body.connection_name, body.database, body.warehouse)
    return {"results": results, "all_success": len(failed) == 0}


@router.get("/status")
async def setup_status():
    conn = get_snowflake_conn()
    if conn is None:
        raise HTTPException(503, "Snowflake not connected")
    steps = get_setup_status(conn)
    return {"current_connection": get_connection_name(), "steps": steps}


@router.post("/setup")
async def run_setup_route():
    conn = get_snowflake_conn()
    if conn is None:
        raise HTTPException(503, "Snowflake not connected")
    results = run_setup(conn)
    return {"results": results}


@router.post("/migrate/preflight")
async def migrate_preflight(body: MigrateRequest):
    source_conn = None
    target_conn = None
    try:
        source_conn = get_temp_connection(body.source)
        target_conn = get_temp_connection(body.target)
        result = get_migration_preflight(source_conn, target_conn)
        return result
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        if source_conn:
            try:
                source_conn.close()
            except Exception:
                pass
        if target_conn:
            try:
                target_conn.close()
            except Exception:
                pass


@router.post("/migrate")
async def migrate(body: MigrateRequest):
    source_conn = None
    target_conn = None
    try:
        source_conn = get_temp_connection(body.source)
        target_conn = get_temp_connection(body.target)

        table_results = run_migration(source_conn, target_conn)

        files_result = copy_local_files(BASE_DIR, BASE_DIR)

        search_rebuilt = False
        try:
            rebuild_search_service(target_conn)
            search_rebuilt = True
        except Exception:
            pass

        return {
            "results": table_results,
            "files": files_result,
            "search_rebuilt": search_rebuilt,
        }
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        if source_conn:
            try:
                source_conn.close()
            except Exception:
                pass
        if target_conn:
            try:
                target_conn.close()
            except Exception:
                pass
