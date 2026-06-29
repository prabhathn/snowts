-- SnowTS Stored Procedures
-- Replace {{DB}} with your database name and {{WH}} with your warehouse name before executing.

CREATE OR REPLACE PROCEDURE {{DB}}.APP.ANNOTATE_WIKI_ARTICLE(ARTICLE_SLUG VARCHAR, INSTRUCTION VARCHAR)
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS CALLER
AS
$$
import json
import uuid
from datetime import datetime, timezone

def run(session, article_slug: str, instruction: str) -> str:
    rows = session.sql(
        "SELECT wa.ID AS WIKI_ID, a.ID AS ARTICLE_ID, a.CONTENT_HASH, ac.CONTENT "
        "FROM {{DB}}.APP.WIKI_ARTICLES wa "
        "JOIN {{DB}}.APP.ARTICLES a ON LOWER(a.SLUG) = LOWER(wa.SLUG) AND a.SOURCE_TYPE = 'wiki' "
        "JOIN {{DB}}.APP.ARTICLE_CONTENT ac ON ac.ARTICLE_ID = a.ID "
        "WHERE LOWER(wa.SLUG) = LOWER(?)",
        params=[article_slug]
    ).collect()
    if not rows:
        return json.dumps({"ok": False, "error": f"Article not found: {article_slug}"})

    row = rows[0]
    wiki_id = row["WIKI_ID"]
    article_id = row["ARTICLE_ID"]
    existing_content = row["CONTENT"] or ""

    prompt = (
        "You are an AI assistant that merges new information into existing wiki articles.\\n\\n"
        "Rules:\\n"
        "- Preserve ALL existing content and structure\\n"
        "- Weave the new information into the relevant sections where it fits contextually\\n"
        "- If the annotation doesn't fit any existing section, add a new section for it\\n"
        "- Keep the same Markdown formatting style (headings, lists, bold, etc.)\\n"
        "- Do NOT remove or summarize away any existing detail\\n"
        "- If the annotation contradicts existing info, keep both but note the update\\n"
        "- Use [[topic-slug|Display Text]] format for cross-references to related wiki topics\\n\\n"
        "Return a JSON object with:\\n"
        '- "merged": the full updated article content in Markdown\\n'
        '- "summary": a one-sentence description of what changed\\n\\n'
        "Return ONLY valid JSON, no other text.\\n\\n"
        f"Existing article:\\n---\\n{existing_content[:6000]}\\n---\\n\\n"
        f"Instruction / New information:\\n---\\n{instruction[:2000]}\\n---"
    )

    ai_rows = session.sql(
        "SELECT AI_COMPLETE('claude-sonnet-4-6', ?) AS result",
        params=[prompt]
    ).collect()
    raw = ai_rows[0]["RESULT"] if ai_rows else ""
    if raw.startswith('"') and raw.endswith('"'):
        try:
            raw = json.loads(raw)
        except Exception:
            pass

    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        parsed = {"merged": existing_content + "\\n\\n---\\n\\n" + instruction + "\\n", "summary": "Appended (parse error)"}

    merged = parsed.get("merged", existing_content)
    summary = parsed.get("summary", "Updated article")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    session.sql(
        "UPDATE {{DB}}.APP.ARTICLE_CONTENT SET CONTENT = ? WHERE ARTICLE_ID = ?",
        params=[merged, article_id]
    ).collect()

    session.sql(
        "UPDATE {{DB}}.APP.ARTICLES SET UPDATED_AT = ? WHERE ID = ?",
        params=[now, article_id]
    ).collect()

    session.sql(
        "UPDATE {{DB}}.APP.WIKI_ARTICLES SET UPDATED_AT = ? WHERE ID = ?",
        params=[now, wiki_id]
    ).collect()

    rev_id = str(uuid.uuid4())[:8]
    session.sql(
        "INSERT INTO {{DB}}.APP.ARTICLE_REVISIONS (ID, ARTICLE_ID, CONTENT_SNAPSHOT, CHANGE_REASON, CREATED_AT) "
        "VALUES (?, ?, ?, ?, ?)",
        params=[rev_id, article_id, merged, f"Agent annotation: {instruction[:100]}", now]
    ).collect()

    ann_id = str(uuid.uuid4())[:8]
    session.sql(
        "INSERT INTO {{DB}}.APP.ANNOTATIONS (ID, ARTICLE_ID, HIGHLIGHTED_TEXT, INSTRUCTION, AI_RESPONSE, STATUS, CREATED_AT, PROCESSED_AT) "
        "VALUES (?, ?, ?, ?, ?, 'processed', ?, ?)",
        params=[ann_id, article_id, "", instruction, summary, now, now]
    ).collect()

    return json.dumps({"ok": True, "slug": article_slug, "summary": summary, "merged": merged})
$$;
