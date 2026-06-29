import hashlib
import json
import os
import re
import shutil
import subprocess
import traceback
from datetime import datetime
from pathlib import Path

from ..db import (
    sf_execute, sf_execute_no_fetch, is_online, gen_id, queue_offline,
    RAW_DIR, NOTES_DIR, get_connection_name,
)
from .ai import CORTEX_MODEL, ai_complete, _parse_json
from .shared import upsert_client
from . import wiki
from . import activity
from .config import db_prefix



SUPPORTED_EXTENSIONS = {".md", ".txt", ".html", ".docx", ".pdf"}
PROCESSED_DIR = RAW_DIR / "processed"
def _stage_name() -> str:
    return f"{db_prefix()}.RAW_DOCS"
SNOW_CLI = os.environ.get("SNOW_CLI", shutil.which("snow") or "/Applications/SnowflakeCLI.app/Contents/MacOS/snow")


def get_content_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def get_raw_files() -> list[str]:
    if not RAW_DIR.exists():
        return []
    return [
        f.name for f in sorted(RAW_DIR.iterdir())
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith(".")
    ]


def get_processed_files() -> list[str]:
    if not PROCESSED_DIR.exists():
        return []
    return [
        f.name for f in sorted(PROCESSED_DIR.iterdir())
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS and not f.name.startswith(".")
    ]


def get_pending_raw_files() -> list[str]:
    all_raw = get_raw_files()
    processed = set(get_processed_files())
    return [f for f in all_raw if f not in processed]


def _upload_files_to_stage(files: list[Path], batch_id: str | None = None) -> int:
    conn_name = get_connection_name()
    uploaded = 0
    for f in files:
        if batch_id:
            activity.update_file_status(batch_id, f.name, "uploading", "Uploading to Snowflake stage")
        try:
            result = subprocess.run(
                [SNOW_CLI, "stage", "copy", str(f), f"@{_stage_name()}/", "--connection", conn_name, "--overwrite"],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                uploaded += 1
                if batch_id:
                    activity.update_file_status(batch_id, f.name, "uploaded", "Uploaded to stage")
            else:
                if batch_id:
                    activity.update_file_status(batch_id, f.name, "error", "Upload failed")
        except Exception:
            if batch_id:
                activity.update_file_status(batch_id, f.name, "error", "Upload failed")
    if uploaded > 0:
        sf_execute_no_fetch(f"ALTER STAGE {db_prefix()}.RAW_DOCS REFRESH")
    return uploaded


def _run_ai_pipeline(filenames: list[str], batch_id: str | None = None) -> list[dict]:
    if not filenames:
        return []

    placeholders = ", ".join(["%s"] * len(filenames))

    for f in filenames:
        if batch_id:
            activity.update_file_status(batch_id, f, "analyzing", "Parsing document content")

    sf_execute_no_fetch(f"DELETE FROM {db_prefix()}.RAW_DOCS_STAGING WHERE TRUE")

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.RAW_DOCS_STAGING (filename, parsed_content)
        SELECT
            relative_path AS filename,
            AI_PARSE_DOCUMENT(
                TO_FILE('@{db_prefix()}.RAW_DOCS', relative_path),
                {{'mode': 'LAYOUT'}}
            ):content::STRING AS parsed_content
        FROM DIRECTORY(@{db_prefix()}.RAW_DOCS)
        WHERE relative_path IN ({placeholders})
    """, filenames)

    if batch_id:
        for f in filenames:
            activity.update_file_status(batch_id, f, "classifying", "Classifying document type")

    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.RAW_DOCS_STAGING
        SET doc_type = AI_CLASSIFY(
            LEFT(parsed_content, 4000),
            [
                {{'label': 'client-notes', 'description': 'Notes about a specific client or customer engagement, meeting, or relationship'}},
                {{'label': 'internal-meeting', 'description': 'Internal team meeting notes, standups, planning sessions not specific to one client'}},
                {{'label': 'general-topic', 'description': 'General knowledge article, research, or reference material on a topic'}}
            ],
            {{'task_description': 'Classify this document based on its content type'}}
        ):labels[0]::VARCHAR
        WHERE filename IN ({placeholders})
    """, filenames)

    if batch_id:
        for f in filenames:
            activity.update_file_status(batch_id, f, "extracting", "Extracting title, summary, entities")

    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.RAW_DOCS_STAGING
        SET extracted_fields = AI_EXTRACT(
            LEFT(parsed_content, 8000),
            [
                'title: A concise descriptive title for this document (5-10 words)',
                'summary: A 2-3 sentence summary of the key points and outcomes',
                'client_name: The primary client or company discussed (not Snowflake, not internal people). Return null if no external client',
                'contacts: Comma-separated list of people mentioned with roles, e.g. John Smith (VP Sales), Jane Doe (Engineer)',
                'action_items: Comma-separated list of clearly actionable next steps with a verb and object (e.g. Send proposal to X, Schedule meeting with Y). Only include items with a concrete action or deadline, not vague observations or discussion points. Return empty string if none found'
            ]
        ):response
        WHERE filename IN ({placeholders})
    """, filenames)

    gap_fill = sf_execute(f"""
        SELECT filename, parsed_content
        FROM {db_prefix()}.RAW_DOCS_STAGING
        WHERE filename IN ({placeholders})
          AND (extracted_fields:title IS NULL OR TRIM(extracted_fields:title::STRING) = ''
               OR extracted_fields:summary IS NULL OR TRIM(extracted_fields:summary::STRING) = '')
    """, filenames)

    for row in gap_fill:
        fname = row["filename"]
        content_preview = (row.get("parsed_content") or "")[:2000]
        try:
            fill_rows = sf_execute(f"""
                SELECT AI_COMPLETE(
                    '{CORTEX_MODEL}',
                    %s
                ) AS result
            """, [f"Given this document, generate a JSON object with 'title' (concise 5-10 word title) and 'summary' (2-3 sentences). Return ONLY valid JSON.\n\n{content_preview}"])
            if fill_rows:
                raw = fill_rows[0].get("result") or ""
                m = re.search(r'\{[\s\S]*\}', raw)
                if m:
                    parsed = json.loads(m.group())
                    sets = []
                    params = []
                    if parsed.get("title"):
                        sets.append("extracted_fields = OBJECT_INSERT(extracted_fields, 'title', %s::VARIANT, TRUE)")
                        params.append(parsed["title"])
                    if parsed.get("summary"):
                        sets.append("extracted_fields = OBJECT_INSERT(extracted_fields, 'summary', %s::VARIANT, TRUE)")
                        params.append(parsed["summary"])
                    if sets:
                        params.append(fname)
                        sf_execute_no_fetch(f"""
                            UPDATE {db_prefix()}.RAW_DOCS_STAGING
                            SET {', '.join(sets)}
                            WHERE filename = %s
                        """, params)
        except Exception:
            pass

    if batch_id:
        for f in filenames:
            activity.update_file_status(batch_id, f, "tagging", "Assigning topic tags")

    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.RAW_DOCS_STAGING
        SET tags = AI_CLASSIFY(
            LEFT(parsed_content, 4000),
            [
                {{'label': 'ai-ml', 'description': 'Artificial intelligence, machine learning, LLMs, models'}},
                {{'label': 'data-platform', 'description': 'Data warehousing, data lakes, Snowflake platform, data engineering'}},
                {{'label': 'sales', 'description': 'Sales processes, pipeline, deals, revenue, account management'}},
                {{'label': 'product', 'description': 'Product features, roadmap, releases, product management'}},
                {{'label': 'security', 'description': 'Security, compliance, governance, access control'}},
                {{'label': 'infrastructure', 'description': 'Cloud infrastructure, DevOps, deployment, containers'}},
                {{'label': 'analytics', 'description': 'Business analytics, dashboards, reporting, BI tools'}},
                {{'label': 'partnership', 'description': 'Partner relationships, integrations, ecosystem'}},
                {{'label': 'customer-success', 'description': 'Customer onboarding, support, success, adoption'}},
                {{'label': 'strategy', 'description': 'Business strategy, planning, competitive analysis'}}
            ],
            {{'output_mode': 'multi', 'task_description': 'Tag this document with all relevant topic categories'}}
        ):labels
        WHERE filename IN ({placeholders})
    """, filenames)

    for row_data in sf_execute(f"""
        SELECT filename, LEFT(parsed_content, 4000) AS preview, doc_type,
               extracted_fields:title::STRING AS title,
               extracted_fields:summary::STRING AS summary
        FROM {db_prefix()}.RAW_DOCS_STAGING
        WHERE filename IN ({placeholders})
    """, filenames):
        fname = row_data["filename"]
        if batch_id:
            activity.update_file_status(batch_id, fname, "mapping", "Identifying wiki topics")
        preview = row_data.get("preview") or ""
        doc_title = row_data.get("title") or fname
        doc_summary = row_data.get("summary") or ""
        doc_type_val = row_data.get("doc_type") or "general-topic"
        try:
            prompt = f"""Analyze this document and identify 1-5 knowledge topics that should exist in a personal wiki.

Document title: {doc_title}
Document type: {doc_type_val}
Document summary: {doc_summary}

Document excerpt:
{preview}

For each topic, return:
- slug: URL-friendly lowercase slug (e.g. "ai-in-enterprise")
- title: Human-readable title (e.g. "AI in Enterprise")
- category: One of: technology, product, strategy, industry, people, process
- content_contribution: A DETAILED analysis (2-4 paragraphs) of what this document reveals about this topic. Include specific facts, data points, named entities, trends, and implications. Do NOT write a vague summary — extract concrete knowledge that would be useful in a personal wiki.

Return a JSON object with key "wiki_topics" containing an array of topic objects.
Return ONLY valid JSON, no other text."""
            result = ai_complete(prompt, max_tokens=4000)
            parsed = _parse_json(result)
            topics = parsed.get("wiki_topics", [])
            if topics:
                sf_execute_no_fetch(f"""
                    UPDATE {db_prefix()}.RAW_DOCS_STAGING
                    SET wiki_topics = PARSE_JSON(%s)
                    WHERE filename = %s
                """, [json.dumps(topics), fname])
        except Exception:
            traceback.print_exc()

    rows = sf_execute(f"""
        SELECT filename, parsed_content, doc_type, extracted_fields, tags, wiki_topics
        FROM {db_prefix()}.RAW_DOCS_STAGING
        WHERE filename IN ({placeholders})
    """, filenames)

    return rows


def _populate_tables(staging_rows: list[dict], batch_id: str | None = None) -> int:
    count = 0
    now = datetime.utcnow().isoformat()

    for row in staging_rows:
        try:
            filename = row["filename"]
            if batch_id:
                activity.update_file_status(batch_id, filename, "processing", "Saving to knowledge base")
            content = row.get("parsed_content") or ""
            doc_type = row.get("doc_type") or "general-topic"
            fields = row.get("extracted_fields") or {}
            tag_list = row.get("tags") or []

            if isinstance(fields, str):
                try:
                    fields = json.loads(fields)
                except Exception:
                    fields = {}
            if isinstance(tag_list, str):
                try:
                    tag_list = json.loads(tag_list)
                except Exception:
                    tag_list = []

            title = fields.get("title") or filename.replace(".docx", "").replace("-", " ").title()
            summary = fields.get("summary") or ""
            if isinstance(summary, list):
                summary = " ".join(str(s) for s in summary)
            client_name = fields.get("client_name")
            contacts_str = fields.get("contacts") or ""
            action_items_str = fields.get("action_items") or ""

            if client_name and client_name.lower() in ("null", "none", "n/a", ""):
                client_name = None

            slug = title.lower().replace(" ", "-")[:80]
            content_hash = get_content_hash(content)
            article_id = gen_id()

            existing = sf_execute(
                f"SELECT id FROM {db_prefix()}.ARTICLES WHERE raw_source_path = %s AND source_type = 'raw'",
                [filename]
            )
            if existing:
                article_id = existing[0]["id"]
                sf_execute_no_fetch(f"""
                    UPDATE {db_prefix()}.ARTICLES
                    SET title = %s, slug = %s, content_hash = %s, summary = %s, updated_at = %s
                    WHERE id = %s
                """, [title, slug, content_hash, summary, now, article_id])
                sf_execute_no_fetch(f"""
                    UPDATE {db_prefix()}.ARTICLE_CONTENT
                    SET title = %s, content = %s, client_name = %s, tags_text = %s
                    WHERE article_id = %s
                """, [title, content[:100000], client_name, ", ".join(tag_list), article_id])
            else:
                sf_execute_no_fetch(f"""
                    INSERT INTO {db_prefix()}.ARTICLES (id, title, slug, file_path, content_hash, summary, source_type, raw_source_path, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 'raw', %s, %s, %s)
                """, [article_id, title, slug, f"raw/{filename}", content_hash, summary, filename, now, now])

                sf_execute_no_fetch(f"""
                    INSERT INTO {db_prefix()}.ARTICLE_CONTENT (id, article_id, title, content, source_type, client_name, tags_text)
                    VALUES (%s, %s, %s, %s, 'raw', %s, %s)
                """, [gen_id(), article_id, title, content[:100000], client_name, ", ".join(tag_list)])

            if client_name:
                upsert_client(client_name, {"industry": "", "summary": summary}, _parse_contacts(contacts_str), article_id, now)

            if doc_type == "client-notes" and client_name:
                _append_to_client_notes(client_name, content, filename)

            for tag_name in tag_list:
                _upsert_tag(tag_name, "topic", article_id)

            wiki_topics = row.get("wiki_topics") or []
            if isinstance(wiki_topics, str):
                try:
                    wiki_topics = json.loads(wiki_topics)
                except Exception:
                    wiki_topics = []

            for topic in wiki_topics:
                try:
                    t_slug = (topic.get("slug") or "").strip()
                    t_title = (topic.get("title") or "").strip()
                    t_category = (topic.get("category") or "uncategorized").strip()
                    t_contribution = (topic.get("content_contribution") or "").strip()
                    if t_slug and t_title and t_contribution:
                        if batch_id:
                            activity.update_file_status(batch_id, filename, "enriching", f"Wiki: {t_title}")
                        wiki.merge_content_into_article(
                            slug=t_slug, title=t_title, category=t_category,
                            content_block=t_contribution, source_article_id=article_id,
                            tags=tag_list[:3] if tag_list else None
                        )
                except Exception:
                    traceback.print_exc()

            if batch_id:
                activity.update_file_status(batch_id, filename, "done", "Complete")
            count += 1
        except Exception:
            traceback.print_exc()
            continue

    if batch_id:
        activity.complete_batch(batch_id, "completed", f"{count} file{'s' if count != 1 else ''} processed")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    for row in staging_rows:
        fn = row["filename"]
        src = RAW_DIR / fn
        if src.exists():
            try:
                shutil.move(str(src), str(PROCESSED_DIR / fn))
            except Exception:
                pass

    try:
        wiki.rebuild_index()
    except Exception:
        traceback.print_exc()

    try:
        wiki.relink_all_wiki_articles()
    except Exception:
        traceback.print_exc()

    try:
        wiki.enrich_short_articles()
    except Exception:
        traceback.print_exc()

    return count


def _parse_contacts(contacts_str: str) -> list[dict]:
    if not contacts_str:
        return []
    contacts = []
    for part in contacts_str.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r'^(.+?)\s*\((.+?)\)\s*$', part)
        if m:
            contacts.append({"name": m.group(1).strip(), "role": m.group(2).strip()})
        else:
            contacts.append({"name": part, "role": ""})
    return contacts



def run_pipeline() -> dict:
    if not is_online():
        activity.emit_simple("doc_pipeline", "Pipeline failed", "Snowflake offline", "error")
        return {"id": gen_id(), "pipeline_type": "raw_ingest", "status": "failed",
                "files_processed": 0, "error_log": "Snowflake offline", "started_at": datetime.utcnow().isoformat()}

    pending_files = get_pending_raw_files()
    if not pending_files:
        activity.emit_simple("doc_pipeline", "No files to process", "", "info")
        return {"id": gen_id(), "pipeline_type": "raw_ingest", "status": "completed",
                "files_processed": 0, "error_log": None,
                "started_at": datetime.utcnow().isoformat(), "completed_at": datetime.utcnow().isoformat()}

    run_id = gen_id()
    started_at = datetime.utcnow().isoformat()
    errors = []
    batch_id = activity.create_batch("doc_pipeline", pending_files)

    sf_execute_no_fetch(f"""
        INSERT INTO {db_prefix()}.PIPELINE_RUNS (id, pipeline_type, status, files_processed, started_at)
        VALUES (%s, 'raw_ingest', 'running', 0, %s)
    """, [run_id, started_at])

    file_paths = [RAW_DIR / f for f in pending_files]
    uploaded = _upload_files_to_stage(file_paths, batch_id)
    if uploaded == 0:
        errors.append("Failed to upload any files to stage")

    files_processed = 0
    staging_rows = []
    try:
        staging_rows = _run_ai_pipeline(pending_files, batch_id)

        if staging_rows:
            try:
                files_processed = _populate_tables(staging_rows, batch_id)
            except Exception as e:
                errors.append(f"Table population failed: {str(e)}")
    except Exception as e:
        errors.append(f"AI pipeline failed: {str(e)}")

    status = "completed" if not errors else ("completed" if files_processed > 0 else "failed")
    error_log = "\n".join(errors) if errors else None
    completed_at = datetime.utcnow().isoformat()
    if not files_processed:
        activity.complete_batch(batch_id, status, error_log or "No files processed")

    try:
        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.PIPELINE_RUNS
            SET status = %s, files_processed = %s, error_log = %s, completed_at = %s
            WHERE id = %s
        """, [status, files_processed, error_log, completed_at, run_id])
    except Exception:
        pass

    return {
        "id": run_id, "pipeline_type": "raw_ingest", "status": status,
        "files_processed": files_processed, "error_log": error_log,
        "started_at": started_at, "completed_at": completed_at,
        "batch_id": batch_id,
    }





def _append_to_client_notes(client_name: str, text: str, source_filename: str):
    slug = client_name.lower().replace(" ", "-").replace("/", "-")
    notes_path = NOTES_DIR / "clients" / f"{slug}.md"
    notes_path.parent.mkdir(parents=True, exist_ok=True)

    structured_md = _structure_client_document(client_name, text, source_filename)

    if not notes_path.exists() or notes_path.stat().st_size == 0:
        notes_path.write_text(f"# {client_name}\n\n{structured_md}\n", encoding="utf-8")
    else:
        with open(notes_path, "a", encoding="utf-8") as f:
            f.write(f"\n\n{structured_md}\n")


def _structure_client_document(client_name: str, text: str, source_filename: str) -> str:
    MAX_CHUNK = 12000
    if len(text) <= MAX_CHUNK:
        return _ai_structure_chunk(client_name, text, source_filename)

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + MAX_CHUNK, len(text))
        if end < len(text):
            break_at = text.rfind("\n\n", start, end)
            if break_at > start + 2000:
                end = break_at
        chunks.append(text[start:end])
        start = end

    sections = []
    for i, chunk in enumerate(chunks):
        label = f"(part {i + 1}/{len(chunks)})"
        result = _ai_structure_chunk(client_name, chunk, f"{source_filename} {label}")
        sections.append(result)

    return "\n\n".join(sections)


def _ai_structure_chunk(client_name: str, text: str, source_label: str) -> str:
    prompt = f"""You are formatting raw OCR text from a client document into clean, structured Markdown notes.

Client: {client_name}
Source: {source_label}

Rules:
- Identify distinct meetings, engagements, or topic sections within the text
- For each section, create a Markdown heading (## or ###) with the date and/or topic
- Under each section include:
  - A brief summary paragraph (2-4 sentences)
  - Key discussion points as bullet lists
  - People mentioned with their roles (bold name, role in parentheses)
  - Any action items prefixed with "- [ ] "
- Use proper Markdown formatting: headings, bold, bullet lists, horizontal rules between sections
- Preserve important details like dates, names, dollar amounts, product names
- Remove OCR artifacts, duplicated text, and formatting noise
- If dates are present, use them as section headers (e.g., "## 2026-04-03 | Prep Call")
- If no clear date, use descriptive topic headers (e.g., "## Partnership Overview")
- Do NOT add information that isn't in the source text
- Do NOT wrap output in code fences

Raw text:
{text}

Return ONLY the formatted Markdown, no preamble."""

    try:
        rows = sf_execute(
            f"SELECT AI_COMPLETE('{CORTEX_MODEL}', %s) AS result",
            [prompt]
        )
        result = (rows[0].get("result") or "").strip() if rows else ""
        if result.startswith("```"):
            result = result.split("\n", 1)[1] if "\n" in result else result[3:]
            result = result.rsplit("```", 1)[0].strip()
        if result:
            return result
    except Exception:
        pass

    return f"---\n## From: {source_label}\n*Imported: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}*\n\n{text[:5000]}\n"


def _upsert_tag(name: str, tag_type: str, article_id: str):
    existing = sf_execute(
        f"SELECT id FROM {db_prefix()}.TAGS WHERE LOWER(name) = LOWER(%s)", [name]
    )
    if existing:
        tag_id = existing[0]["id"]
    else:
        tag_id = gen_id()
        sf_execute_no_fetch(
            f"INSERT INTO {db_prefix()}.TAGS (id, name, tag_type) VALUES (%s, %s, %s)",
            [tag_id, name, tag_type]
        )

    exists = sf_execute(
        f"SELECT 1 FROM {db_prefix()}.ARTICLE_TAGS WHERE article_id = %s AND tag_id = %s",
        [article_id, tag_id]
    )
    if not exists:
        sf_execute_no_fetch(
            f"INSERT INTO {db_prefix()}.ARTICLE_TAGS (article_id, tag_id) VALUES (%s, %s)",
            [article_id, tag_id]
        )



