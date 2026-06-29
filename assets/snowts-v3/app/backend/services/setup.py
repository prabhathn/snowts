import logging
import shutil
from pathlib import Path

import snowflake.connector

from .config import db_name, db_prefix, wh_name

logger = logging.getLogger(__name__)


def _resolve(sql: str) -> str:
    return sql.replace("SNOWTS_DB", db_name()).replace("SNOWTS_WH", wh_name())

TABLE_DDL = {
    "ARTICLES": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ARTICLES (
    ID TEXT NOT NULL PRIMARY KEY,
    TITLE TEXT,
    SLUG TEXT,
    FILE_PATH TEXT,
    CONTENT_HASH TEXT,
    SUMMARY TEXT,
    SOURCE_TYPE TEXT,
    RAW_SOURCE_PATH TEXT,
    CREATED_AT TIMESTAMP_NTZ,
    UPDATED_AT TIMESTAMP_NTZ
)""",
    "ARTICLE_CONTENT": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ARTICLE_CONTENT (
    ID TEXT NOT NULL PRIMARY KEY,
    ARTICLE_ID TEXT,
    TITLE TEXT,
    CONTENT TEXT,
    SOURCE_TYPE TEXT,
    CLIENT_NAME TEXT,
    TAGS_TEXT TEXT
)""",
    "ARTICLE_REVISIONS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ARTICLE_REVISIONS (
    ID TEXT NOT NULL PRIMARY KEY,
    ARTICLE_ID TEXT,
    CONTENT_SNAPSHOT TEXT,
    CHANGE_REASON TEXT,
    CREATED_AT TIMESTAMP_NTZ
)""",
    "ARTICLE_LINKS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ARTICLE_LINKS (
    SOURCE_ARTICLE_ID TEXT,
    TARGET_ARTICLE_ID TEXT,
    LINK_TYPE TEXT
)""",
    "ARTICLE_TAGS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ARTICLE_TAGS (
    ARTICLE_ID TEXT,
    TAG_ID TEXT
)""",
    "CLIENTS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.CLIENTS (
    ID TEXT NOT NULL PRIMARY KEY,
    NAME TEXT,
    INDUSTRY TEXT,
    ENGAGEMENT_STATUS TEXT,
    SUMMARY TEXT,
    LAST_CONTACT DATE,
    CREATED_AT TIMESTAMP_NTZ
)""",
    "CLIENT_CONTACTS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.CLIENT_CONTACTS (
    ID TEXT NOT NULL PRIMARY KEY,
    CLIENT_ID TEXT,
    NAME TEXT,
    ROLE TEXT,
    EMAIL TEXT
)""",
    "TAGS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.TAGS (
    ID TEXT NOT NULL PRIMARY KEY,
    NAME TEXT,
    TAG_TYPE TEXT
)""",
    "TODOS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.TODOS (
    ID TEXT NOT NULL PRIMARY KEY,
    TITLE TEXT,
    DESCRIPTION TEXT,
    SOURCE_ARTICLE_ID TEXT,
    CLIENT_ID TEXT,
    STATUS TEXT,
    DUE_DATE DATE,
    PRIORITY TEXT,
    CREATED_AT TIMESTAMP_NTZ,
    TAGS_TEXT TEXT,
    GROUP_NAME TEXT,
    CONFIDENCE TEXT,
    SOURCE TEXT,
    REJECTED_AT TIMESTAMP_NTZ,
    ARCHIVED_AT TIMESTAMP_NTZ
)""",
    "ANNOTATIONS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.ANNOTATIONS (
    ID TEXT NOT NULL PRIMARY KEY,
    ARTICLE_ID TEXT,
    HIGHLIGHTED_TEXT TEXT,
    INSTRUCTION TEXT,
    AI_RESPONSE TEXT,
    STATUS TEXT,
    CREATED_AT TIMESTAMP_NTZ,
    PROCESSED_AT TIMESTAMP_NTZ
)""",
    "PIPELINE_RUNS": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.PIPELINE_RUNS (
    ID TEXT NOT NULL PRIMARY KEY,
    PIPELINE_TYPE TEXT,
    STATUS TEXT,
    FILES_PROCESSED NUMBER,
    ERROR_LOG TEXT,
    STARTED_AT TIMESTAMP_NTZ,
    COMPLETED_AT TIMESTAMP_NTZ
)""",
    "WIKI_ARTICLES": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.WIKI_ARTICLES (
    ID TEXT NOT NULL PRIMARY KEY,
    SLUG TEXT NOT NULL,
    TITLE TEXT NOT NULL,
    SUMMARY TEXT,
    CATEGORY TEXT,
    PARENT_TOPIC TEXT,
    SOURCE_ARTICLE_IDS TEXT,
    TAGS_TEXT TEXT,
    CREATED_AT TIMESTAMP_NTZ,
    UPDATED_AT TIMESTAMP_NTZ
)""",
    "RAW_DOCS_STAGING": """
CREATE TABLE IF NOT EXISTS SNOWTS_DB.APP.RAW_DOCS_STAGING (
    FILENAME TEXT,
    PARSED_CONTENT TEXT,
    DOC_TYPE TEXT,
    EXTRACTED_FIELDS VARIANT,
    TAGS VARIANT,
    WIKI_TOPICS VARIANT
)""",
}

SEARCH_SERVICE_DDL = """
CREATE CORTEX SEARCH SERVICE IF NOT EXISTS SNOWTS_DB.APP.SNOWTS_SEARCH_SERVICE
  ON content
  ATTRIBUTES title, source_type, client_name
  WAREHOUSE = 'SNOWTS_WH'
  TARGET_LAG = '1 hour'
  AS (
    SELECT id, title, content, source_type, client_name, tags_text
    FROM SNOWTS_DB.APP.ARTICLE_CONTENT
  )
"""

WIKI_SEARCH_SERVICE_DDL = """
CREATE CORTEX SEARCH SERVICE IF NOT EXISTS SNOWTS_DB.APP.WIKI_SEARCH_SERVICE
  ON content
  ATTRIBUTES title, source_type, client_name, tags_text
  WAREHOUSE = 'SNOWTS_WH'
  TARGET_LAG = '1 hour'
  AS (
    SELECT id, title, content, source_type, client_name, tags_text
    FROM SNOWTS_DB.APP.ARTICLE_CONTENT
    WHERE source_type = 'wiki'
  )
"""

SEMANTIC_VIEW_YAML = """
name: SNOWTS_SEMANTIC_VIEW
description: Semantic view over the SnowTS personal knowledge base metadata including wiki articles, todos, clients, and pipeline runs.
tables:
  - name: WIKI_ARTICLES
    description: Wiki knowledge base articles organized by topic and category
    base_table:
      database: SNOWTS_DB
      schema: APP
      table: WIKI_ARTICLES
    primary_key:
      columns:
        - ID
    dimensions:
      - name: ID
        expr: ID
        data_type: VARCHAR
      - name: SLUG
        description: URL-friendly identifier for the wiki article
        expr: SLUG
        data_type: VARCHAR
      - name: TITLE
        description: Human-readable title of the wiki article
        synonyms:
          - article name
          - topic name
        expr: TITLE
        data_type: VARCHAR
      - name: CATEGORY
        description: Topic category such as technology, product, strategy, industry, people, or process
        synonyms:
          - topic category
          - article category
        expr: CATEGORY
        data_type: VARCHAR
      - name: TAGS_TEXT
        description: Comma-separated tags associated with the article
        expr: TAGS_TEXT
        data_type: VARCHAR
      - name: CREATED_AT
        description: When the wiki article was first created
        expr: CREATED_AT
        data_type: TIMESTAMP_NTZ
      - name: UPDATED_AT
        description: When the wiki article was last updated
        expr: UPDATED_AT
        data_type: TIMESTAMP_NTZ
    metrics:
      - name: ARTICLE_COUNT
        description: Total number of wiki articles
        expr: COUNT(WIKI_ARTICLES.ID)
  - name: TODOS
    description: Action items and tasks extracted from documents, notes, and manual entry
    base_table:
      database: SNOWTS_DB
      schema: APP
      table: TODOS
    primary_key:
      columns:
        - ID
    dimensions:
      - name: ID
        expr: ID
        data_type: VARCHAR
      - name: TITLE
        description: Short description of the todo action item
        synonyms:
          - task name
          - action item
        expr: TITLE
        data_type: VARCHAR
      - name: STATUS
        description: "Current status of the todo. Values are backlog, todo, in_progress, or done"
        synonyms:
          - task status
        expr: STATUS
        data_type: VARCHAR
      - name: PRIORITY
        description: Priority level of the todo
        expr: PRIORITY
        data_type: VARCHAR
      - name: DUE_DATE
        description: When the todo is due
        expr: DUE_DATE
        data_type: DATE
      - name: GROUP_NAME
        description: Grouping label for related todos
        expr: GROUP_NAME
        data_type: VARCHAR
      - name: CONFIDENCE
        description: "Confidence level of the todo extraction, high for manual, low for AI-generated"
        expr: CONFIDENCE
        data_type: VARCHAR
      - name: SOURCE
        description: "Where the todo came from such as ai-pipeline, ai-inbox, ai-quicknote, or manual"
        expr: SOURCE
        data_type: VARCHAR
      - name: CREATED_AT
        description: When the todo was created
        expr: CREATED_AT
        data_type: TIMESTAMP_NTZ
      - name: ARCHIVED_AT
        description: "When the todo was archived, null if still active"
        expr: ARCHIVED_AT
        data_type: TIMESTAMP_NTZ
      - name: REJECTED_AT
        description: "When the todo was rejected, null if not rejected"
        expr: REJECTED_AT
        data_type: TIMESTAMP_NTZ
      - name: CLIENT_ID
        description: Foreign key to the client this todo relates to
        expr: CLIENT_ID
        data_type: VARCHAR
    metrics:
      - name: TODO_COUNT
        description: Total number of todos
        expr: COUNT(TODOS.ID)
      - name: ACTIVE_TODO_COUNT
        description: Number of active todos that are not archived or rejected
        expr: "COUNT(CASE WHEN TODOS.ARCHIVED_AT IS NULL AND TODOS.REJECTED_AT IS NULL AND TODOS.STATUS != 'done' THEN 1 END)"
      - name: OVERDUE_COUNT
        description: Number of todos that are past their due date and not completed
        expr: "COUNT(CASE WHEN TODOS.DUE_DATE < CURRENT_DATE AND TODOS.STATUS NOT IN ('done') AND TODOS.ARCHIVED_AT IS NULL AND TODOS.REJECTED_AT IS NULL THEN 1 END)"
  - name: CLIENTS
    description: Client organizations tracked in the knowledge base
    base_table:
      database: SNOWTS_DB
      schema: APP
      table: CLIENTS
    primary_key:
      columns:
        - ID
    dimensions:
      - name: ID
        expr: ID
        data_type: VARCHAR
      - name: NAME
        description: Client organization name
        synonyms:
          - company name
          - client name
        expr: NAME
        data_type: VARCHAR
      - name: INDUSTRY
        description: Industry vertical of the client
        expr: INDUSTRY
        data_type: VARCHAR
      - name: ENGAGEMENT_STATUS
        description: Current engagement status with the client
        expr: ENGAGEMENT_STATUS
        data_type: VARCHAR
      - name: LAST_CONTACT
        description: Date of last interaction with the client
        expr: LAST_CONTACT
        data_type: DATE
      - name: CREATED_AT
        description: When the client record was created
        expr: CREATED_AT
        data_type: TIMESTAMP_NTZ
    metrics:
      - name: CLIENT_COUNT
        description: Total number of clients
        expr: COUNT(CLIENTS.ID)
  - name: PIPELINE_RUNS
    description: Document processing pipeline execution history
    base_table:
      database: SNOWTS_DB
      schema: APP
      table: PIPELINE_RUNS
    primary_key:
      columns:
        - ID
    dimensions:
      - name: ID
        expr: ID
        data_type: VARCHAR
      - name: PIPELINE_TYPE
        description: Type of pipeline run
        expr: PIPELINE_TYPE
        data_type: VARCHAR
      - name: STATUS
        description: "Pipeline run status such as completed, failed, or running"
        synonyms:
          - run status
        expr: STATUS
        data_type: VARCHAR
      - name: STARTED_AT
        description: When the pipeline run started
        expr: STARTED_AT
        data_type: TIMESTAMP_NTZ
      - name: COMPLETED_AT
        description: When the pipeline run finished
        expr: COMPLETED_AT
        data_type: TIMESTAMP_NTZ
    facts:
      - name: FILES_PROCESSED
        description: Number of files processed in this pipeline run
        expr: FILES_PROCESSED
        data_type: NUMBER
    metrics:
      - name: RUN_COUNT
        description: Total number of pipeline runs
        expr: COUNT(PIPELINE_RUNS.ID)
      - name: TOTAL_FILES_PROCESSED
        description: Total number of files processed across all runs
        expr: SUM(PIPELINE_RUNS.FILES_PROCESSED)
relationships:
  - name: TODOS_TO_CLIENTS
    left_table: TODOS
    right_table: CLIENTS
    relationship_columns:
      - left_column: CLIENT_ID
        right_column: ID
    relationship_type: many_to_one
custom_instructions: "All TIMESTAMP_NTZ columns store UTC values. Do NOT add date or time filters such as created_at <= CURRENT_TIMESTAMP() unless the user explicitly asks to filter by a date range."
"""

ANNOTATE_PROCEDURE_DDL = """
CREATE OR REPLACE PROCEDURE SNOWTS_DB.APP.ANNOTATE_WIKI_ARTICLE(ARTICLE_SLUG VARCHAR, INSTRUCTION VARCHAR)
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
        "FROM SNOWTS_DB.APP.WIKI_ARTICLES wa "
        "JOIN SNOWTS_DB.APP.ARTICLES a ON LOWER(a.SLUG) = LOWER(wa.SLUG) AND a.SOURCE_TYPE = 'wiki' "
        "JOIN SNOWTS_DB.APP.ARTICLE_CONTENT ac ON ac.ARTICLE_ID = a.ID "
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
        "UPDATE SNOWTS_DB.APP.ARTICLE_CONTENT SET CONTENT = ? WHERE ARTICLE_ID = ?",
        params=[merged, article_id]
    ).collect()

    session.sql(
        "UPDATE SNOWTS_DB.APP.ARTICLES SET UPDATED_AT = ? WHERE ID = ?",
        params=[now, article_id]
    ).collect()

    session.sql(
        "UPDATE SNOWTS_DB.APP.WIKI_ARTICLES SET UPDATED_AT = ? WHERE ID = ?",
        params=[now, wiki_id]
    ).collect()

    rev_id = str(uuid.uuid4())[:8]
    session.sql(
        "INSERT INTO SNOWTS_DB.APP.ARTICLE_REVISIONS (ID, ARTICLE_ID, CONTENT_SNAPSHOT, CHANGE_REASON, CREATED_AT) "
        "VALUES (?, ?, ?, ?, ?)",
        params=[rev_id, article_id, merged, f"Agent annotation: {instruction[:100]}", now]
    ).collect()

    ann_id = str(uuid.uuid4())[:8]
    session.sql(
        "INSERT INTO SNOWTS_DB.APP.ANNOTATIONS (ID, ARTICLE_ID, HIGHLIGHTED_TEXT, INSTRUCTION, AI_RESPONSE, STATUS, CREATED_AT, PROCESSED_AT) "
        "VALUES (?, ?, ?, ?, ?, 'processed', ?, ?)",
        params=[ann_id, article_id, "", instruction, summary, now, now]
    ).collect()

    return json.dumps({"ok": True, "slug": article_slug, "summary": summary, "merged": merged})
$$
"""

AGENT_DDL = """
CREATE OR REPLACE AGENT SNOWTS_DB.APP.SNOWTS_AGENT
  COMMENT = 'SnowTS knowledge base assistant with wiki search, content search, structured data queries, web search, and article annotation'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto

  orchestration:
    budget:
      seconds: 120
      tokens: 100000

  instructions:
    orchestration: >
      You are a knowledge base assistant for a personal wiki about the technology industry, AI, Snowflake, and enterprise software.
      When the user asks to add, expand, update, enrich, or annotate content in an article, use the annotate_article tool.
      IMPORTANT: The article_slug is provided in the context prefix as [Context: Wiki article "Title" (slug)]. Extract the slug from there.
      Before annotating, search the wiki and source content first to gather related material, then pass a rich instruction to annotate_article that includes what you found.
      When asked about facts, market data, or recent events, use web search to find current information.
      For questions about counts, status, or metadata (how many articles, overdue todos, pipeline history), use the structured data query tool.
      All timestamps in the database are stored as UTC TIMESTAMP_NTZ. Do not add date or time filters unless the user explicitly asks for a date range.
      Cite sources when using web search results.
    response: >
      Return responses in clean Markdown. Use ## subheadings for sections.
      Use [[topic-slug|Display Text]] format to cross-reference related wiki topics where relevant.
      Be specific with facts, names, numbers, and dates — avoid vague summaries.
      When you annotate an article, tell the user what was changed and confirm the update was saved.
    sample_questions:
      - question: "What does the wiki say about AI adoption in enterprises?"
        answer: "I'll search the wiki for articles related to enterprise AI adoption and summarize the key findings."
      - question: "What are the latest funding rounds in AI?"
        answer: "I'll search the web for recent AI funding news and compile the results."
      - question: "Add a section about Snowflake Arctic to this article"
        answer: "I'll search for information about Snowflake Arctic, then use the annotate tool to add a new section to the article."

  tools:
    - tool_spec:
        type: cortex_search
        name: search_wiki
        description: >
          Search the personal wiki articles for related topics, concepts, and knowledge.
          Use this to find existing coverage of a topic before writing new content,
          to cross-reference between articles, or to check what the wiki already says about a subject.
    - tool_spec:
        type: cortex_search
        name: search_all_content
        description: >
          Search all source material including raw documents, meeting notes, and wiki articles.
          Use this to find original source documents, raw data, or content that may not have been
          synthesized into wiki articles yet.
    - tool_spec:
        type: cortex_analyst_text_to_sql
        name: query_data
        description: >
          Query structured metadata about the knowledge base: wiki article counts by category,
          todo items and their status/priority, client information, and pipeline run history.
          Use for questions about counts, trends, and status of the knowledge base itself.
    - tool_spec:
        type: web_search
        name: web_search
        description: >
          Search the web for current information, recent news, market data, funding announcements,
          product updates, and documentation. Use when the user asks about recent events,
          latest data, or information not found in the wiki.
    - tool_spec:
        type: generic
        name: annotate_article
        description: >
          Modify, enrich, expand, or annotate a wiki article with new content. Use this tool when the user asks to
          add a section, update information, expand on a topic, include new details, or otherwise change an article.
          The article_slug identifies which article to update and the instruction describes what to add or change.
          Always search for related content first before calling this tool so you can provide a richer instruction.
        input_schema:
          type: object
          properties:
            article_slug:
              type: string
              description: The slug identifier of the wiki article to annotate (e.g. "snowflake-overview")
            instruction:
              type: string
              description: Detailed instruction of what to add or change in the article. Include any relevant context or facts gathered from searches.
          required:
            - article_slug
            - instruction

  tool_resources:
    search_wiki:
      name: SNOWTS_DB.APP.WIKI_SEARCH_SERVICE
      max_results: 10
    search_all_content:
      name: SNOWTS_DB.APP.SNOWTS_SEARCH_SERVICE
      max_results: 10
    query_data:
      semantic_view: SNOWTS_DB.APP.SNOWTS_SEMANTIC_VIEW
      execution_environment:
        type: warehouse
        warehouse: SNOWTS_WH
        query_timeout: 120
    web_search:
      enabled: true
    annotate_article:
      type: procedure
      identifier: SNOWTS_DB.APP.ANNOTATE_WIKI_ARTICLE
      execution_environment:
        type: warehouse
        warehouse: SNOWTS_WH
        query_timeout: 120
  $$
"""

TABLE_ORDER = [
    "ARTICLES", "ARTICLE_CONTENT", "ARTICLE_REVISIONS", "ARTICLE_LINKS",
    "ARTICLE_TAGS", "CLIENTS", "CLIENT_CONTACTS", "TAGS", "TODOS",
    "ANNOTATIONS", "PIPELINE_RUNS", "WIKI_ARTICLES", "RAW_DOCS_STAGING",
]

MIGRATION_ORDER = [
    "CLIENTS", "TAGS", "ARTICLES", "ARTICLE_CONTENT", "ARTICLE_REVISIONS",
    "ARTICLE_LINKS", "ARTICLE_TAGS", "CLIENT_CONTACTS", "TODOS",
    "ANNOTATIONS", "PIPELINE_RUNS", "WIKI_ARTICLES",
]

MERGE_KEYS = {
    "ARTICLES": ["ID"],
    "ARTICLE_CONTENT": ["ID"],
    "ARTICLE_REVISIONS": ["ID"],
    "ARTICLE_LINKS": ["SOURCE_ARTICLE_ID", "TARGET_ARTICLE_ID"],
    "ARTICLE_TAGS": ["ARTICLE_ID", "TAG_ID"],
    "CLIENTS": ["ID"],
    "CLIENT_CONTACTS": ["ID"],
    "TAGS": ["ID"],
    "TODOS": ["ID"],
    "ANNOTATIONS": ["ID"],
    "PIPELINE_RUNS": ["ID"],
    "WIKI_ARTICLES": ["ID"],
}

TABLE_COLUMNS = {
    "ARTICLES": ["ID", "TITLE", "SLUG", "FILE_PATH", "CONTENT_HASH", "SUMMARY", "SOURCE_TYPE", "RAW_SOURCE_PATH", "CREATED_AT", "UPDATED_AT"],
    "ARTICLE_CONTENT": ["ID", "ARTICLE_ID", "TITLE", "CONTENT", "SOURCE_TYPE", "CLIENT_NAME", "TAGS_TEXT"],
    "ARTICLE_REVISIONS": ["ID", "ARTICLE_ID", "CONTENT_SNAPSHOT", "CHANGE_REASON", "CREATED_AT"],
    "ARTICLE_LINKS": ["SOURCE_ARTICLE_ID", "TARGET_ARTICLE_ID", "LINK_TYPE"],
    "ARTICLE_TAGS": ["ARTICLE_ID", "TAG_ID"],
    "CLIENTS": ["ID", "NAME", "INDUSTRY", "ENGAGEMENT_STATUS", "SUMMARY", "LAST_CONTACT", "CREATED_AT"],
    "CLIENT_CONTACTS": ["ID", "CLIENT_ID", "NAME", "ROLE", "EMAIL"],
    "TAGS": ["ID", "NAME", "TAG_TYPE"],
    "TODOS": ["ID", "TITLE", "DESCRIPTION", "SOURCE_ARTICLE_ID", "CLIENT_ID", "STATUS", "DUE_DATE", "PRIORITY", "CREATED_AT", "CONFIDENCE", "SOURCE", "REJECTED_AT", "ARCHIVED_AT"],
    "ANNOTATIONS": ["ID", "ARTICLE_ID", "HIGHLIGHTED_TEXT", "INSTRUCTION", "AI_RESPONSE", "STATUS", "CREATED_AT", "PROCESSED_AT"],
    "PIPELINE_RUNS": ["ID", "PIPELINE_TYPE", "STATUS", "FILES_PROCESSED", "ERROR_LOG", "STARTED_AT", "COMPLETED_AT"],
    "WIKI_ARTICLES": ["ID", "SLUG", "TITLE", "SUMMARY", "CATEGORY", "PARENT_TOPIC", "SOURCE_ARTICLE_IDS", "TAGS_TEXT", "CREATED_AT", "UPDATED_AT"],
}


def _exec(conn, sql, params=None, fetch=True):
    cur = conn.cursor()
    cur.execute(sql, params or [])
    if fetch and cur.description:
        cols = [d[0].lower() for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    return []


def _exec_no_fetch(conn, sql, params=None):
    cur = conn.cursor()
    cur.execute(sql, params or [])


def list_connections() -> list[dict]:
    import tomllib
    toml_path = Path.home() / ".snowflake" / "connections.toml"
    if not toml_path.exists():
        return []
    with open(toml_path, "rb") as f:
        data = tomllib.load(f)
    connections = []
    for name, cfg in data.items():
        connections.append({
            "name": name,
            "account": cfg.get("account", ""),
            "user": cfg.get("user", ""),
            "database": cfg.get("database", ""),
        })
    return connections


def test_connection(name: str) -> dict:
    try:
        conn = snowflake.connector.connect(connection_name=name)
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_ROLE()")
        row = cur.fetchone()
        conn.close()
        return {"ok": True, "account": row[0], "user": row[1], "role": row[2]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_setup_status(conn) -> list[dict]:
    db = db_name()
    wh = wh_name()
    p = db_prefix()
    steps = []

    try:
        rows = _exec(conn, f"SHOW DATABASES LIKE '{db}'")
        steps.append({"id": "database", "label": f"Database: {db}", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "database", "label": f"Database: {db}", "exists": False})

    try:
        rows = _exec(conn, f"SHOW SCHEMAS LIKE 'APP' IN DATABASE {db}")
        steps.append({"id": "schema", "label": f"Schema: {p}", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "schema", "label": f"Schema: {p}", "exists": False})

    try:
        rows = _exec(conn, f"SHOW WAREHOUSES LIKE '{wh}'")
        steps.append({"id": "warehouse", "label": f"Warehouse: {wh}", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "warehouse", "label": f"Warehouse: {wh}", "exists": False})

    for table_name in TABLE_ORDER:
        try:
            rows = _exec(
                conn,
                f"SELECT 1 FROM {db}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='APP' AND TABLE_NAME=%s",
                [table_name],
            )
            exists = len(rows) > 0
        except Exception:
            exists = False
        steps.append({"id": f"table_{table_name.lower()}", "label": f"Table: {table_name}", "exists": exists})

    try:
        rows = _exec(conn, f"SHOW STAGES LIKE 'RAW_DOCS' IN SCHEMA {p}")
        steps.append({"id": "stage_raw_docs", "label": "Stage: RAW_DOCS", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "stage_raw_docs", "label": "Stage: RAW_DOCS", "exists": False})

    try:
        rows = _exec(conn, f"SHOW CORTEX SEARCH SERVICES LIKE 'SNOWTS_SEARCH_SERVICE' IN SCHEMA {p}")
        steps.append({"id": "search_service", "label": "Cortex Search Service: SNOWTS_SEARCH_SERVICE", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "search_service", "label": "Cortex Search Service: SNOWTS_SEARCH_SERVICE", "exists": False})

    try:
        rows = _exec(conn, f"SHOW CORTEX SEARCH SERVICES LIKE 'WIKI_SEARCH_SERVICE' IN SCHEMA {p}")
        steps.append({"id": "wiki_search_service", "label": "Cortex Search Service: WIKI_SEARCH_SERVICE", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "wiki_search_service", "label": "Cortex Search Service: WIKI_SEARCH_SERVICE", "exists": False})

    try:
        rows = _exec(conn, f"SHOW SEMANTIC VIEWS LIKE 'SNOWTS_SEMANTIC_VIEW' IN SCHEMA {p}")
        steps.append({"id": "semantic_view", "label": "Semantic View: SNOWTS_SEMANTIC_VIEW", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "semantic_view", "label": "Semantic View: SNOWTS_SEMANTIC_VIEW", "exists": False})

    try:
        rows = _exec(conn, f"SHOW PROCEDURES LIKE 'ANNOTATE_WIKI_ARTICLE' IN SCHEMA {p}")
        steps.append({"id": "annotate_procedure", "label": "Procedure: ANNOTATE_WIKI_ARTICLE", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "annotate_procedure", "label": "Procedure: ANNOTATE_WIKI_ARTICLE", "exists": False})

    try:
        rows = _exec(conn, f"SHOW AGENTS LIKE 'SNOWTS_AGENT' IN SCHEMA {p}")
        steps.append({"id": "agent", "label": "Cortex Agent: SNOWTS_AGENT", "exists": len(rows) > 0})
    except Exception:
        steps.append({"id": "agent", "label": "Cortex Agent: SNOWTS_AGENT", "exists": False})

    return steps


def run_setup(conn) -> list[dict]:
    db = db_name()
    wh = wh_name()
    p = db_prefix()
    results = []

    try:
        _exec_no_fetch(conn, f"CREATE DATABASE IF NOT EXISTS {db}")
        results.append({"id": "database", "label": f"Database: {db}", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "database", "label": f"Database: {db}", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, f"CREATE SCHEMA IF NOT EXISTS {p}")
        results.append({"id": "schema", "label": f"Schema: {p}", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "schema", "label": f"Schema: {p}", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, f"""
            CREATE WAREHOUSE IF NOT EXISTS {wh}
            WAREHOUSE_SIZE = 'XSMALL'
            AUTO_SUSPEND = 120
            AUTO_RESUME = TRUE
        """)
        results.append({"id": "warehouse", "label": f"Warehouse: {wh}", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "warehouse", "label": f"Warehouse: {wh}", "success": False, "error": str(e)})

    for table_name in TABLE_ORDER:
        try:
            _exec_no_fetch(conn, _resolve(TABLE_DDL[table_name]))
            results.append({"id": f"table_{table_name.lower()}", "label": f"Table: {table_name}", "success": True, "error": None})
        except Exception as e:
            results.append({"id": f"table_{table_name.lower()}", "label": f"Table: {table_name}", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, f"CREATE STAGE IF NOT EXISTS {p}.RAW_DOCS DIRECTORY = (ENABLE = TRUE)")
        results.append({"id": "stage_raw_docs", "label": "Stage: RAW_DOCS", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "stage_raw_docs", "label": "Stage: RAW_DOCS", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, _resolve(SEARCH_SERVICE_DDL))
        results.append({"id": "search_service", "label": "Cortex Search Service: SNOWTS_SEARCH_SERVICE", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "search_service", "label": "Cortex Search Service: SNOWTS_SEARCH_SERVICE", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, _resolve(WIKI_SEARCH_SERVICE_DDL))
        results.append({"id": "wiki_search_service", "label": "Cortex Search Service: WIKI_SEARCH_SERVICE", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "wiki_search_service", "label": "Cortex Search Service: WIKI_SEARCH_SERVICE", "success": False, "error": str(e)})

    try:
        resolved_yaml = SEMANTIC_VIEW_YAML.replace("SNOWTS_DB", db)
        _exec_no_fetch(conn, f"CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML('{p}', $${resolved_yaml}$$)")
        results.append({"id": "semantic_view", "label": "Semantic View: SNOWTS_SEMANTIC_VIEW", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "semantic_view", "label": "Semantic View: SNOWTS_SEMANTIC_VIEW", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, _resolve(ANNOTATE_PROCEDURE_DDL))
        results.append({"id": "annotate_procedure", "label": "Procedure: ANNOTATE_WIKI_ARTICLE", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "annotate_procedure", "label": "Procedure: ANNOTATE_WIKI_ARTICLE", "success": False, "error": str(e)})

    try:
        _exec_no_fetch(conn, _resolve(AGENT_DDL))
        results.append({"id": "agent", "label": "Cortex Agent: SNOWTS_AGENT", "success": True, "error": None})
    except Exception as e:
        results.append({"id": "agent", "label": "Cortex Agent: SNOWTS_AGENT", "success": False, "error": str(e)})

    return results


def get_migration_preflight(source_conn, target_conn) -> dict:
    p = db_prefix()
    source_counts = {}
    for table_name in MIGRATION_ORDER:
        try:
            rows = _exec(source_conn, f"SELECT COUNT(*) AS cnt FROM {p}.{table_name}")
            source_counts[table_name] = rows[0]["cnt"] if rows else 0
        except Exception:
            source_counts[table_name] = -1

    target_status = get_setup_status(target_conn)
    target_missing = [s["label"] for s in target_status if not s["exists"]]

    return {
        "source_counts": source_counts,
        "target_ready": len(target_missing) == 0,
        "target_missing": target_missing,
    }


def run_migration(source_conn, target_conn) -> list[dict]:
    p = db_prefix()
    results = []

    for table_name in MIGRATION_ORDER:
        try:
            cols = TABLE_COLUMNS[table_name]
            col_list = ", ".join(cols)
            rows = _exec(source_conn, f"SELECT {col_list} FROM {p}.{table_name}")

            if not rows:
                results.append({"table": table_name, "rows_inserted": 0, "rows_updated": 0, "success": True, "error": None})
                continue

            keys = MERGE_KEYS[table_name]
            non_keys = [c for c in cols if c not in keys]

            staging = f"{p}._STAGING_{table_name}"
            _exec_no_fetch(target_conn, f"CREATE OR REPLACE TEMPORARY TABLE {staging} LIKE {p}.{table_name}")

            placeholders = ", ".join(["%s"] * len(cols))
            insert_sql = f"INSERT INTO {staging} ({col_list}) VALUES ({placeholders})"
            cur = target_conn.cursor()
            for row in rows:
                vals = [row.get(c.lower()) for c in cols]
                cur.execute(insert_sql, vals)

            on_clause = " AND ".join([f"t.{k} = s.{k}" for k in keys])

            if non_keys:
                update_set = ", ".join([f"t.{c} = s.{c}" for c in non_keys])
                merge_sql = f"""
                    MERGE INTO {p}.{table_name} t
                    USING {staging} s ON {on_clause}
                    WHEN MATCHED THEN UPDATE SET {update_set}
                    WHEN NOT MATCHED THEN INSERT ({col_list}) VALUES ({', '.join([f's.{c}' for c in cols])})
                """
            else:
                merge_sql = f"""
                    MERGE INTO {p}.{table_name} t
                    USING {staging} s ON {on_clause}
                    WHEN NOT MATCHED THEN INSERT ({col_list}) VALUES ({', '.join([f's.{c}' for c in cols])})
                """

            merge_rows = _exec(target_conn, merge_sql)
            inserted = 0
            updated = 0
            if merge_rows:
                inserted = merge_rows[0].get("number of rows inserted", 0)
                updated = merge_rows[0].get("number of rows updated", 0)

            _exec_no_fetch(target_conn, f"DROP TABLE IF EXISTS {staging}")
            results.append({"table": table_name, "rows_inserted": inserted, "rows_updated": updated, "success": True, "error": None})

        except Exception as e:
            logger.exception("Migration failed for table %s", table_name)
            results.append({"table": table_name, "rows_inserted": 0, "rows_updated": 0, "success": False, "error": str(e)})

    return results


def copy_local_files(source_dir: Path, target_dir: Path) -> dict:
    copied = []
    errors = []
    for subdir in ["notes", "raw", "wiki"]:
        src = source_dir / subdir
        dst = target_dir / subdir
        if not src.exists():
            continue
        try:
            shutil.copytree(src, dst, dirs_exist_ok=True)
            copied.append(subdir)
        except Exception as e:
            errors.append({"dir": subdir, "error": str(e)})
    return {"copied": copied, "errors": errors}


def rebuild_search_service(conn):
    p = db_prefix()
    wh = wh_name()
    _exec_no_fetch(conn, f"""
        CREATE OR REPLACE CORTEX SEARCH SERVICE {p}.SNOWTS_SEARCH_SERVICE
          ON content
          ATTRIBUTES title, source_type, client_name
          WAREHOUSE = '{wh}'
          TARGET_LAG = '1 hour'
          AS (
            SELECT id, title, content, source_type, client_name, tags_text
            FROM {p}.ARTICLE_CONTENT
          )
    """)


def rebuild_wiki_search_service(conn):
    p = db_prefix()
    wh = wh_name()
    _exec_no_fetch(conn, f"""
        CREATE OR REPLACE CORTEX SEARCH SERVICE {p}.WIKI_SEARCH_SERVICE
          ON content
          ATTRIBUTES title, source_type, client_name, tags_text
          WAREHOUSE = '{wh}'
          TARGET_LAG = '1 hour'
          AS (
            SELECT id, title, content, source_type, client_name, tags_text
            FROM {p}.ARTICLE_CONTENT
            WHERE source_type = 'wiki'
          )
    """)
