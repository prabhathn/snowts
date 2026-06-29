from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .routes.notes import router as notes_router
from .routes.pipeline import router as pipeline_router
from .routes.clients import router as clients_router
from .routes.todos import router as todos_router
from .routes.search import router as search_router
from .routes.settings import router as settings_router
from .routes.wiki import router as wiki_router
from .routes.agent import router as agent_router
from .routes.activity import router as activity_router
from .db import is_online, get_pending_offline, sf_execute, RAW_DIR, NOTES_DIR, WIKI_DIR
from .services.config import db_prefix, is_setup_complete

RAW_DIR.mkdir(parents=True, exist_ok=True)
NOTES_DIR.mkdir(parents=True, exist_ok=True)
WIKI_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(application):
    from .services.watcher import start_watcher, stop_watcher
    from .services.pipeline import run_pipeline
    start_watcher(lambda files: run_pipeline())
    yield
    stop_watcher()


app = FastAPI(title="Snowts API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes_router)
app.include_router(pipeline_router)
app.include_router(clients_router)
app.include_router(todos_router)
app.include_router(search_router)
app.include_router(settings_router)
app.include_router(wiki_router)
app.include_router(agent_router)
app.include_router(activity_router)


@app.get("/api/status")
async def status():
    online = is_online()
    pending_sync = len(get_pending_offline())

    pending_raw = 0
    total_articles = 0
    total_clients = 0
    pending_todos = 0
    completed_todos = 0
    total_wiki = 0

    if online:
        try:
            from .services.pipeline import get_pending_raw_files
            pending_raw = get_pending_raw_files()
        except Exception:
            pass

        try:
            rows = sf_execute(f"SELECT COUNT(*) as cnt FROM {db_prefix()}.ARTICLES")
            total_articles = rows[0]["cnt"] if rows else 0
        except Exception:
            pass

        try:
            rows = sf_execute(f"SELECT COUNT(*) as cnt FROM {db_prefix()}.CLIENTS")
            total_clients = rows[0]["cnt"] if rows else 0
        except Exception:
            pass

        try:
            rows = sf_execute(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'done' AND rejected_at IS NULL THEN 1 ELSE 0 END), 0) as done_cnt,
                    COALESCE(SUM(CASE WHEN status != 'done' AND rejected_at IS NULL AND archived_at IS NULL THEN 1 ELSE 0 END), 0) as pending_cnt
                FROM {db_prefix()}.TODOS
            """)
            if rows:
                pending_todos = rows[0]["pending_cnt"]
                completed_todos = rows[0]["done_cnt"]
        except Exception:
            pass

        try:
            rows = sf_execute(f"SELECT COUNT(*) as cnt FROM {db_prefix()}.WIKI_ARTICLES")
            total_wiki = rows[0]["cnt"] if rows else 0
        except Exception:
            pass

    return {
        "online": online,
        "setup_complete": is_setup_complete(),
        "pending_sync": pending_sync,
        "pending_raw": pending_raw,
        "total_articles": total_articles,
        "total_clients": total_clients,
        "pending_todos": pending_todos,
        "completed_todos": completed_todos,
        "total_wiki": total_wiki,
    }


@app.get("/api/dashboard")
async def dashboard():
    online = is_online()
    clients = []
    meetings = []
    wiki_recent = []
    if online:
        try:
            clients = sf_execute(f"""
                SELECT c.id, c.name, c.engagement_status,
                    COALESCE(c.last_contact,
                        (SELECT MAX(a.updated_at) FROM {db_prefix()}.ARTICLES a
                         JOIN {db_prefix()}.ARTICLE_CONTENT ac ON a.id = ac.article_id
                         WHERE LOWER(ac.client_name) = LOWER(c.name))
                    ) as last_contact
                FROM {db_prefix()}.CLIENTS c
                ORDER BY last_contact DESC NULLS LAST, name
                LIMIT 8
            """)
        except Exception:
            pass
        try:
            meetings = sf_execute(f"""
                SELECT ac.id, ac.title, ac.client_name, ac.source_type,
                       LEFT(ac.content, 300) as preview, a.created_at, a.file_path
                FROM {db_prefix()}.ARTICLE_CONTENT ac
                JOIN {db_prefix()}.ARTICLES a ON ac.article_id = a.id
                WHERE ac.source_type IN ('note', 'raw')
                ORDER BY a.created_at DESC
                LIMIT 3
            """)
        except Exception:
            pass
        try:
            wiki_recent = sf_execute(f"""
                SELECT id, slug, title, summary, category, updated_at
                FROM {db_prefix()}.WIKI_ARTICLES
                ORDER BY updated_at DESC
                LIMIT 5
            """)
        except Exception:
            pass
    return {"clients": clients, "meetings": meetings, "wiki_recent": wiki_recent}
