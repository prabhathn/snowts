from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from ..services import wiki
from ..services.ai import process_annotation
from ..db import sf_execute, sf_execute_no_fetch, gen_id, WIKI_DIR
from ..services.config import db_prefix
from datetime import datetime

router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.get("")
async def list_articles(category: Optional[str] = None, tag: Optional[str] = None):
    articles = wiki.list_wiki_articles(category=category, tag=tag)
    return {"articles": articles}


@router.get("/index")
async def wiki_index():
    articles = wiki.list_wiki_articles()
    categories: dict[str, list] = {}
    for a in articles:
        cat = a.get("category") or "Uncategorized"
        categories.setdefault(cat, []).append(a)
    return {"categories": categories}


@router.get("/categories")
async def list_categories():
    cats = wiki.get_wiki_categories()
    return {"categories": cats}


@router.get("/recent")
async def recent_articles():
    articles = wiki.get_recent_wiki_articles(limit=20)
    return {"articles": articles}



@router.get("/{slug}")
async def get_article(slug: str):
    article = wiki.get_wiki_article(slug)
    if not article:
        return {"error": "Not found"}, 404
    return article


class SaveWikiRequest(BaseModel):
    content: str


@router.put("/{slug}")
async def save_article(slug: str, req: SaveWikiRequest):
    wiki.update_wiki_article(slug, req.content, "Manual edit")
    return {"ok": True}


class AnnotateWikiRequest(BaseModel):
    annotation: str


@router.post("/{slug}/annotate")
async def annotate_article(slug: str, req: AnnotateWikiRequest):
    article = wiki.get_wiki_article(slug)
    if not article:
        return {"ok": False, "error": "Not found"}

    result = process_annotation(article["content"], req.annotation)
    wiki.update_wiki_article(slug, result["merged"], f"Annotation: {req.annotation[:100]}")

    art_rows = sf_execute(
        f"SELECT id FROM {db_prefix()}.ARTICLES WHERE LOWER(slug) = LOWER(%s) AND source_type = 'wiki'", [slug]
    )
    if art_rows:
        now = datetime.utcnow().isoformat()
        sf_execute_no_fetch(f"""
            INSERT INTO {db_prefix()}.ANNOTATIONS (id, article_id, highlighted_text, instruction, ai_response, status, created_at, processed_at)
            VALUES (%s, %s, %s, %s, %s, 'processed', %s, %s)
        """, [gen_id(), art_rows[0]["id"], "", req.annotation, result.get("summary", ""), now, now])

    return {"ok": True, "merged": result["merged"], "summary": result.get("summary", "")}


@router.get("/{slug}/links")
async def get_links(slug: str):
    return wiki.get_article_links(slug)


@router.get("/{slug}/history")
async def get_history(slug: str):
    return wiki.get_article_history(slug)


@router.post("/enrich")
async def enrich_articles():
    import threading
    def _run():
        try:
            wiki.enrich_short_articles()
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}
