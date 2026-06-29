import json

from fastapi import APIRouter
from ..db import sf_execute, is_online
from ..services.config import db_prefix

router = APIRouter(prefix="/api/search", tags=["search"])

@router.get("")
async def search(q: str, source_type: str = "", client: str = ""):
    if not is_online() or len(q) < 2:
        return {"results": []}

    try:
        filters = {}
        if source_type:
            filters["@eq"] = {"source_type": source_type}

        filter_str = json.dumps(filters) if filters else "{}"

        results = sf_execute(f"""
            SELECT
                PARSE_JSON(result):title::STRING AS title,
                SUBSTRING(PARSE_JSON(result):content::STRING, 1, 200) AS snippet,
                PARSE_JSON(result):source_type::STRING AS source_type,
                PARSE_JSON(result):client_name::STRING AS client_name,
                'search' AS file_path,
                score
            FROM TABLE(
                {db_prefix()}.SNOWTS_SEARCH_SERVICE!SEARCH(
                    QUERY => %s,
                    COLUMNS => ARRAY_CONSTRUCT('title', 'content', 'source_type', 'client_name'),
                    FILTER => PARSE_JSON(%s),
                    LIMIT => 20
                )
            )
        """, [q, filter_str])

        titles = [r.get("title", "") for r in results]
        file_map: dict[str, str] = {}
        if titles:
            placeholders = ", ".join(["%s"] * len(titles))
            articles = sf_execute(
                f"SELECT title, file_path FROM {db_prefix()}.ARTICLES WHERE title IN ({placeholders})",
                titles
            )
            for a in articles:
                file_map[a["title"]] = a["file_path"]

        formatted = []
        for r in results:
            title = r.get("title", "")
            formatted.append({
                "title": title,
                "snippet": r.get("snippet", ""),
                "source_type": r.get("source_type", ""),
                "client_name": r.get("client_name"),
                "file_path": file_map.get(title, ""),
                "score": float(r.get("score", 0)),
            })

        return {"results": formatted}
    except Exception as e:
        return {"results": [], "error": str(e)}
