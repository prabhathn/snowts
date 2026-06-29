import logging
import re
from datetime import datetime
from pathlib import Path

from ..db import sf_execute, sf_execute_no_fetch, gen_id, WIKI_DIR
from .ai import ai_complete, agent_run, CORTEX_MODEL
from .config import db_prefix

logger = logging.getLogger(__name__)


def get_or_create_wiki_article(slug: str, title: str, category: str = "", tags: list[str] | None = None, summary: str = "") -> dict:
    existing = sf_execute(
        f"SELECT id FROM {db_prefix()}.WIKI_ARTICLES WHERE LOWER(slug) = LOWER(%s)", [slug]
    )
    now = datetime.utcnow().isoformat()

    if existing:
        wiki_id = existing[0]["id"]
        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.WIKI_ARTICLES SET title = %s, category = %s, tags_text = %s, updated_at = %s
            WHERE id = %s
        """, [title, category, ", ".join(tags) if tags else None, now, wiki_id])
        return {"id": wiki_id, "slug": slug, "created": False}

    wiki_id = gen_id()
    article_id = gen_id()

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.WIKI_ARTICLES (id, slug, title, summary, category, parent_topic, source_article_ids, tags_text, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, NULL, NULL, %s, %s, %s)
    """, [wiki_id, slug, title, summary, category, ", ".join(tags) if tags else None, now, now])

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.ARTICLES (id, title, slug, file_path, content_hash, summary, source_type, raw_source_path, created_at, updated_at)
        VALUES (%s, %s, %s, %s, NULL, %s, 'wiki', NULL, %s, %s)
    """, [article_id, title, slug, f"wiki/{slug}.md", summary, now, now])

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.ARTICLE_CONTENT (id, article_id, title, content, source_type, client_name, tags_text)
        VALUES (%s, %s, %s, %s, 'wiki', NULL, %s)
    """, [gen_id(), article_id, title, summary or "", ", ".join(tags) if tags else None])

    md_path = WIKI_DIR / f"{slug}.md"
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(f"# {title}\n\n{summary}\n", encoding="utf-8")

    return {"id": wiki_id, "article_id": article_id, "slug": slug, "created": True}


def update_wiki_article(slug: str, new_content: str, change_reason: str = ""):
    now = datetime.utcnow().isoformat()

    md_path = WIKI_DIR / f"{slug}.md"
    old_content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""

    wiki_rows = sf_execute(f"SELECT id FROM {db_prefix()}.WIKI_ARTICLES WHERE LOWER(slug) = LOWER(%s)", [slug])
    if not wiki_rows:
        return

    art_rows = sf_execute(
        f"SELECT id FROM {db_prefix()}.ARTICLES WHERE LOWER(slug) = LOWER(%s) AND source_type = 'wiki'", [slug]
    )
    if art_rows:
        article_id = art_rows[0]["id"]
        if old_content:
            sf_execute_no_fetch(f"""
                INSERT INTO {db_prefix()}.ARTICLE_REVISIONS (id, article_id, content_snapshot, change_reason, created_at)
                VALUES (%s, %s, %s, %s, %s)
            """, [gen_id(), article_id, old_content[:100000], change_reason, now])

        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.ARTICLE_CONTENT SET content = %s WHERE article_id = %s
        """, [new_content[:100000], article_id])

        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.ARTICLES SET updated_at = %s WHERE id = %s
        """, [now, article_id])

    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.WIKI_ARTICLES SET updated_at = %s WHERE LOWER(slug) = LOWER(%s)
    """, [now, slug])

    md_path.write_text(new_content, encoding="utf-8")

    link_slugs = extract_wiki_links(new_content)
    if art_rows:
        resolve_links(art_rows[0]["id"], link_slugs)


def _get_existing_slugs(exclude_slug: str = "") -> list[str]:
    rows = sf_execute(f"SELECT slug FROM {db_prefix()}.WIKI_ARTICLES ORDER BY slug")
    return [r["slug"] for r in rows if r["slug"] != exclude_slug]


def merge_content_into_article(slug: str, title: str, category: str, content_block: str, source_article_id: str | None = None, tags: list[str] | None = None):
    result = get_or_create_wiki_article(slug, title, category, tags)
    md_path = WIKI_DIR / f"{slug}.md"
    existing_content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""

    existing_slugs = _get_existing_slugs(exclude_slug=slug)
    slug_list = ", ".join(existing_slugs[:80]) if existing_slugs else "(none yet)"

    if len(existing_content.strip()) < 50:
        prompt = f"""Write a wiki article for the topic "{title}" based on this source material:

{content_block[:6000]}

Structure:
1. Start with a one-paragraph SUMMARY that captures the key thesis
2. Follow with a detailed ANALYSIS section using ## subheadings as needed — cover specific facts, data points, named entities, trends, market dynamics, and implications
3. If relevant, add a section on key takeaways or open questions

Rules:
- The article should be 3-8 paragraphs total (summary + detailed analysis)
- Include specific numbers, names, dates, and facts from the source — do NOT be vague
- Use [[topic-slug|Display Text]] format to cross-reference related topics wherever relevant (e.g. [[ai-safety|AI safety concerns]])
- ONLY link to topics that exist in this list: {slug_list}
- Every article MUST include at least one [[link]] if any related topic exists
- Use Markdown formatting with ## subheadings for sections
- Do NOT wrap in code fences

Return ONLY the article content in Markdown (without the # title — that will be added automatically)."""
        try:
            generated = ai_complete(prompt, max_tokens=3000)
            if generated.startswith("```"):
                generated = generated.split("\n", 1)[1] if "\n" in generated else generated[3:]
                generated = generated.rsplit("```", 1)[0].strip()
            if generated.startswith(f"# {title}"):
                generated = generated[len(f"# {title}"):].strip()
            if len(generated.strip()) > 100:
                new_content = f"# {title}\n\n{generated}\n"
            else:
                new_content = f"# {title}\n\n{content_block}\n"
        except Exception:
            new_content = f"# {title}\n\n{content_block}\n"
        update_wiki_article(slug, new_content, "Initial content from source")
    else:
        prompt = f"""You are merging new knowledge into an existing wiki article.

Existing article:
---
{existing_content[:8000]}
---

New content to integrate:
---
{content_block[:6000]}
---

Existing wiki topics you can link to: {slug_list}

Rules:
- Preserve ALL existing content and structure
- Weave new information into the appropriate sections, adding depth and specific details
- If new info doesn't fit existing sections, add a new ## subsection
- EXPAND thin sections — if a section is only 1-2 sentences, flesh it out with the new material
- Maintain consistent Markdown formatting with ## subheadings
- Keep the one-paragraph summary at the top updated to reflect all content
- Use [[topic-slug|Display Text]] format for cross-references to other topics (e.g. [[ai-safety|AI safety concerns]])
- ONLY link to topics from the list above — do NOT invent link targets
- Every article MUST include at least 1-3 [[links]] to related topics if they exist
- Do NOT duplicate information already present
- Do NOT remove existing content
- Keep it factual with specific details (names, numbers, dates)

Return ONLY the full updated article content in Markdown, no preamble or code fences."""

        try:
            merged = ai_complete(prompt, max_tokens=4000)
            if merged.startswith("```"):
                merged = merged.split("\n", 1)[1] if "\n" in merged else merged[3:]
                merged = merged.rsplit("```", 1)[0].strip()
            if len(merged.strip()) > 50:
                update_wiki_article(slug, merged, "Merged content from source")
            else:
                _append_content(slug, content_block)
        except Exception:
            _append_content(slug, content_block)

    if source_article_id:
        wiki_rows = sf_execute(f"SELECT source_article_ids FROM {db_prefix()}.WIKI_ARTICLES WHERE LOWER(slug) = LOWER(%s)", [slug])
        if wiki_rows:
            existing_ids = wiki_rows[0].get("source_article_ids") or ""
            id_set = set(existing_ids.split(",")) if existing_ids else set()
            id_set.discard("")
            id_set.add(source_article_id)
            sf_execute_no_fetch(f"""
                UPDATE {db_prefix()}.WIKI_ARTICLES SET source_article_ids = %s WHERE LOWER(slug) = LOWER(%s)
            """, [",".join(id_set), slug])


def _append_content(slug: str, content_block: str):
    md_path = WIKI_DIR / f"{slug}.md"
    existing = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    new_content = existing.rstrip() + f"\n\n---\n\n{content_block}\n"
    update_wiki_article(slug, new_content, "Appended new content block")


def extract_wiki_links(content: str) -> list[str]:
    return re.findall(r'\[\[([a-z0-9-]+)\]\]', content.lower())


def resolve_links(source_article_id: str, link_slugs: list[str]):
    sf_execute_no_fetch(
        f"DELETE FROM {db_prefix()}.ARTICLE_LINKS WHERE source_article_id = %s AND link_type = 'wiki-reference'",
        [source_article_id]
    )
    for slug in link_slugs:
        target = sf_execute(
            f"SELECT id FROM {db_prefix()}.ARTICLES WHERE LOWER(slug) = LOWER(%s) AND source_type = 'wiki'", [slug]
        )
        if target:
            sf_execute_no_fetch(f"""
                INSERT INTO {db_prefix()}.ARTICLE_LINKS (source_article_id, target_article_id, link_type)
                VALUES (%s, %s, 'wiki-reference')
            """, [source_article_id, target[0]["id"]])


def relink_all_wiki_articles():
    articles = sf_execute(f"""
        SELECT a.id, a.slug FROM {db_prefix()}.ARTICLES a
        WHERE a.source_type = 'wiki'
    """)
    for art in articles:
        md_path = WIKI_DIR / f"{art['slug']}.md"
        if md_path.exists():
            content = md_path.read_text(encoding="utf-8")
            link_slugs = extract_wiki_links(content)
            if link_slugs:
                resolve_links(art["id"], link_slugs)


def enrich_short_articles():
    existing_slugs = _get_existing_slugs()
    enriched = 0
    for slug in existing_slugs:
        md_path = WIKI_DIR / f"{slug}.md"
        if not md_path.exists():
            continue
        content = md_path.read_text(encoding="utf-8")
        has_links = bool(extract_wiki_links(content))
        body = re.sub(r'^#\s+.+\n*', '', content).strip()
        is_short = len(body) < 1500
        if has_links and not is_short:
            continue
        other_slugs = [s for s in existing_slugs if s != slug]
        other_list = ", ".join(other_slugs[:80])
        title_match = re.match(r'^#\s+(.+)', content)
        title = title_match.group(1).strip() if title_match else slug.replace("-", " ").title()

        source_content = _get_source_content_for_topic(slug, title)

        agent_prompt = f"""Expand and enrich this wiki article about "{title}". The article is too short or missing cross-references.

Current article:
---
{content[:4000]}
---
"""
        if source_content:
            agent_prompt += f"""
Original source material:
---
{source_content[:6000]}
---
"""
        agent_prompt += f"""
Search the wiki for related content and the web for current facts. Then rewrite and EXPAND this into a detailed knowledge base entry.

Rules:
- Start with a one-paragraph SUMMARY capturing the key thesis
- Follow with a detailed ANALYSIS using ## subheadings
- 3-8 paragraphs total
- Include specific numbers, names, dates — do NOT be vague
- Use [[topic-slug|Display Text]] cross-references to related wiki topics (e.g. [[ai-safety|AI safety concerns]])
- Preserve all existing facts — expand, do not replace
- Return ONLY the article body in Markdown (without the # title line), no code fences"""

        try:
            result = agent_run(agent_prompt)
            if result:
                if result.startswith("```"):
                    result = result.split("\n", 1)[1] if "\n" in result else result[3:]
                    result = result.rsplit("```", 1)[0].strip()
                if result.startswith(f"# {title}"):
                    result = result[len(f"# {title}"):].strip()
                if len(result.strip()) > len(body) and len(result.strip()) > 100:
                    update_wiki_article(slug, f"# {title}\n\n{result}\n", "Agent-enriched with detail and cross-links")
                    enriched += 1
                    continue
        except Exception:
            pass

        prompt = f"""Rewrite and EXPAND this wiki article into a detailed knowledge base entry.

Current article:
---
{content[:4000]}
---
"""
        if source_content:
            prompt += f"""
Original source material for additional context:
---
{source_content[:6000]}
---
"""
        prompt += f"""
Existing wiki topics you can link to: {other_list}

Rules:
- Start with a one-paragraph SUMMARY capturing the key thesis
- Follow with a detailed ANALYSIS using ## subheadings — cover specific facts, data points, names, market dynamics, and implications
- The article should be 3-8 paragraphs total (summary + analysis)
- Include specific numbers, names, dates from available material — do NOT be vague
- Add [[topic-slug|Display Text]] cross-references to related topics from the list above (e.g. [[ai-safety|AI safety concerns]])
- ONLY link to slugs from the list — do NOT invent targets
- Every article should have at least 1-3 [[links]]
- Preserve all existing facts — expand, do not replace
- Return ONLY the full article in Markdown (without # title), no code fences"""
        try:
            result = ai_complete(prompt, max_tokens=3000)
            if result.startswith("```"):
                result = result.split("\n", 1)[1] if "\n" in result else result[3:]
                result = result.rsplit("```", 1)[0].strip()
            if result.startswith(f"# {title}"):
                result = result[len(f"# {title}"):].strip()
            if len(result.strip()) > len(body) and len(result.strip()) > 100:
                update_wiki_article(slug, f"# {title}\n\n{result}\n", "Enriched with detail and cross-links")
                enriched += 1
        except Exception:
            pass
    relink_all_wiki_articles()
    try:
        rebuild_index()
    except Exception:
        pass
    return enriched


def _get_source_content_for_topic(slug: str, title: str) -> str:
    wiki_rows = sf_execute(
        f"SELECT source_article_ids FROM {db_prefix()}.WIKI_ARTICLES WHERE LOWER(slug) = LOWER(%s)", [slug]
    )
    if not wiki_rows:
        return ""
    source_ids = (wiki_rows[0].get("source_article_ids") or "").split(",")
    source_ids = [s.strip() for s in source_ids if s.strip()]
    if not source_ids:
        return ""
    chunks = []
    for sid in source_ids[:3]:
        rows = sf_execute(
            f"SELECT LEFT(content, 3000) as content FROM {db_prefix()}.ARTICLE_CONTENT WHERE article_id = %s", [sid]
        )
        if rows and rows[0].get("content"):
            chunks.append(rows[0]["content"])
    return "\n\n---\n\n".join(chunks)


def rebuild_index():
    rows = sf_execute(f"""
        SELECT slug, title, summary, category
        FROM {db_prefix()}.WIKI_ARTICLES
        ORDER BY category, title
    """)

    categories: dict[str, list[dict]] = {}
    for row in rows:
        cat = row.get("category") or "Uncategorized"
        categories.setdefault(cat, []).append(row)

    lines = ["# Knowledge Base Index\n"]
    for cat in sorted(categories.keys()):
        lines.append(f"\n## {cat.title()}\n")
        for article in categories[cat]:
            summary_part = f" - {article['summary']}" if article.get("summary") else ""
            lines.append(f"- [[{article['slug']}]]{summary_part}")
    lines.append("")

    index_path = WIKI_DIR / "INDEX.md"
    index_path.write_text("\n".join(lines), encoding="utf-8")


def get_wiki_article(slug: str) -> dict | None:
    rows = sf_execute(f"""
        SELECT w.id, w.slug, w.title, w.summary, w.category, w.parent_topic,
               w.source_article_ids, w.tags_text, w.created_at, w.updated_at
        FROM {db_prefix()}.WIKI_ARTICLES w
        WHERE LOWER(w.slug) = LOWER(%s)
    """, [slug])
    if not rows:
        return None

    article = rows[0]
    md_path = WIKI_DIR / f"{slug}.md"
    article["content"] = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    article["tags"] = [t.strip() for t in (article.get("tags_text") or "").split(",") if t.strip()]
    return article


def list_wiki_articles(category: str | None = None, tag: str | None = None) -> list[dict]:
    sql = f"SELECT id, slug, title, summary, category, tags_text, updated_at FROM {db_prefix()}.WIKI_ARTICLES"
    params = []
    conditions = []
    if category:
        conditions.append("LOWER(category) = LOWER(%s)")
        params.append(category)
    if tag:
        conditions.append("LOWER(tags_text) LIKE %s")
        params.append(f"%{tag.lower()}%")
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY updated_at DESC"

    rows = sf_execute(sql, params)
    for row in rows:
        row["tags"] = [t.strip() for t in (row.get("tags_text") or "").split(",") if t.strip()]
    return rows


def get_wiki_categories() -> list[dict]:
    rows = sf_execute(f"""
        SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*) AS count
        FROM {db_prefix()}.WIKI_ARTICLES
        GROUP BY category
        ORDER BY count DESC
    """)
    return rows


def get_article_links(slug: str) -> dict:
    art = sf_execute(
        f"SELECT id FROM {db_prefix()}.ARTICLES WHERE LOWER(slug) = LOWER(%s) AND source_type = 'wiki'", [slug]
    )
    if not art:
        return {"outgoing": [], "incoming": []}

    article_id = art[0]["id"]

    outgoing = sf_execute(f"""
        SELECT al.target_article_id, al.link_type, a.title, a.slug
        FROM {db_prefix()}.ARTICLE_LINKS al
        JOIN {db_prefix()}.ARTICLES a ON al.target_article_id = a.id
        WHERE al.source_article_id = %s
    """, [article_id])

    incoming = sf_execute(f"""
        SELECT al.source_article_id, al.link_type, a.title, a.slug
        FROM {db_prefix()}.ARTICLE_LINKS al
        JOIN {db_prefix()}.ARTICLES a ON al.source_article_id = a.id
        WHERE al.target_article_id = %s
    """, [article_id])

    return {"outgoing": outgoing, "incoming": incoming}


def get_article_history(slug: str) -> dict:
    art = sf_execute(
        f"SELECT id FROM {db_prefix()}.ARTICLES WHERE LOWER(slug) = LOWER(%s) AND source_type = 'wiki'", [slug]
    )
    if not art:
        return {"revisions": [], "annotations": []}

    article_id = art[0]["id"]

    revisions = sf_execute(f"""
        SELECT id, change_reason, created_at
        FROM {db_prefix()}.ARTICLE_REVISIONS
        WHERE article_id = %s
        ORDER BY created_at DESC
        LIMIT 20
    """, [article_id])

    annotations = sf_execute(f"""
        SELECT id, highlighted_text, instruction, status, created_at, processed_at
        FROM {db_prefix()}.ANNOTATIONS
        WHERE article_id = %s
        ORDER BY created_at DESC
        LIMIT 20
    """, [article_id])

    return {"revisions": revisions, "annotations": annotations}


def get_recent_wiki_articles(limit: int = 20) -> list[dict]:
    rows = sf_execute(f"""
        SELECT id, slug, title, summary, category, tags_text, updated_at
        FROM {db_prefix()}.WIKI_ARTICLES
        ORDER BY updated_at DESC
        LIMIT %s
    """, [limit])
    for row in rows:
        row["tags"] = [t.strip() for t in (row.get("tags_text") or "").split(",") if t.strip()]
    return rows
