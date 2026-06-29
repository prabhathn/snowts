# DATA.md -- Data Contract Specification

This document defines the **rigid** data layer for SnowTS. Every instance of the application MUST implement these contracts exactly for interoperability. Data portability between instances depends on schema compatibility.

## Database Architecture

| Component | Value | Configurable? |
|---|---|---|
| Database name | `{{DB}}` (default: `SNOWTS_DB`) | Yes |
| Schema name | `APP` | No |
| Warehouse name | `{{WH}}` (default: `SNOWTS_WH`) | Yes |
| Fully qualified prefix | `{{DB}}.APP` | Derived |

All SQL in `scripts/` uses `{{DB}}` and `{{WH}}` as placeholders. Replace before execution.

## Tables

Full DDL is in `scripts/ddl.sql`. The tables below document the contract.

### ARTICLES -- Master article registry

Every piece of content (note, raw doc, wiki article) gets an entry here.

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| TITLE | TEXT | Yes | Human-readable title |
| SLUG | TEXT | Yes | URL-friendly identifier |
| FILE_PATH | TEXT | Yes | Local filesystem path |
| CONTENT_HASH | TEXT | Yes | Hash for dedup/change detection |
| SUMMARY | TEXT | Yes | AI-generated or manual summary |
| SOURCE_TYPE | TEXT | Yes | One of: `note`, `raw`, `wiki`, `url` |
| RAW_SOURCE_PATH | TEXT | Yes | Path to original raw file |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC creation time |
| UPDATED_AT | TIMESTAMP_NTZ | Yes | UTC last update time |

### ARTICLE_CONTENT -- Full-text content for search

Indexed by Cortex Search. One row per article.

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID |
| TITLE | TEXT | Yes | Denormalized title for search |
| CONTENT | TEXT | Yes | Full markdown/text content |
| SOURCE_TYPE | TEXT | Yes | Denormalized from ARTICLES |
| CLIENT_NAME | TEXT | Yes | Associated client name for filtering |
| TAGS_TEXT | TEXT | Yes | Comma-separated tags for filtering |

### ARTICLE_REVISIONS -- Version history

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID |
| CONTENT_SNAPSHOT | TEXT | Yes | Full content at this revision |
| CHANGE_REASON | TEXT | Yes | Description of what changed |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC timestamp of revision |

### ARTICLE_LINKS -- Directed cross-reference graph

| Column | Type | Nullable | Description |
|---|---|---|---|
| SOURCE_ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID (link origin) |
| TARGET_ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID (link target) |
| LINK_TYPE | TEXT | Yes | Relationship type (e.g., `reference`, `related`) |

### ARTICLE_TAGS -- Article-to-tag join

| Column | Type | Nullable | Description |
|---|---|---|---|
| ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID |
| TAG_ID | TEXT | Yes | FK to TAGS.ID |

### CLIENTS -- Client/company records

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| NAME | TEXT | Yes | Client organization name |
| INDUSTRY | TEXT | Yes | Industry vertical |
| ENGAGEMENT_STATUS | TEXT | Yes | Current engagement status |
| SUMMARY | TEXT | Yes | Description or notes about client |
| LAST_CONTACT | DATE | Yes | Date of last interaction |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC creation time |

### CLIENT_CONTACTS -- Contact people per client

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| CLIENT_ID | TEXT | Yes | FK to CLIENTS.ID |
| NAME | TEXT | Yes | Contact person name |
| ROLE | TEXT | Yes | Job title or role |
| EMAIL | TEXT | Yes | Email address |

### TAGS -- Tag registry

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| NAME | TEXT | Yes | Tag display name |
| TAG_TYPE | TEXT | Yes | One of: `topic`, `client`, `person`, `technology` |

### TODOS -- Action items and tasks

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| TITLE | TEXT | Yes | Short task description |
| DESCRIPTION | TEXT | Yes | Detailed description |
| SOURCE_ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID (origin document) |
| CLIENT_ID | TEXT | Yes | FK to CLIENTS.ID |
| STATUS | TEXT | Yes | One of: `backlog`, `todo`, `in_progress`, `done` |
| DUE_DATE | DATE | Yes | When the task is due |
| PRIORITY | TEXT | Yes | Priority level |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC creation time |
| TAGS_TEXT | TEXT | Yes | Comma-separated tags |
| GROUP_NAME | TEXT | Yes | Grouping label for related todos |
| CONFIDENCE | TEXT | Yes | `high` for manual, `low` for AI-generated |
| SOURCE | TEXT | Yes | One of: `ai-pipeline`, `ai-inbox`, `ai-quicknote`, `manual` |
| REJECTED_AT | TIMESTAMP_NTZ | Yes | When rejected (null if active) |
| ARCHIVED_AT | TIMESTAMP_NTZ | Yes | When archived (null if active) |

### ANNOTATIONS -- AI annotation records

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| ARTICLE_ID | TEXT | Yes | FK to ARTICLES.ID |
| HIGHLIGHTED_TEXT | TEXT | Yes | Selected text that prompted annotation |
| INSTRUCTION | TEXT | Yes | User instruction to the AI |
| AI_RESPONSE | TEXT | Yes | AI-generated response/summary |
| STATUS | TEXT | Yes | Processing status (e.g., `processed`) |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC creation time |
| PROCESSED_AT | TIMESTAMP_NTZ | Yes | UTC processing time |

### PIPELINE_RUNS -- Processing pipeline log

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| PIPELINE_TYPE | TEXT | Yes | Type of pipeline run |
| STATUS | TEXT | Yes | One of: `completed`, `failed`, `running` |
| FILES_PROCESSED | NUMBER | Yes | Count of files processed |
| ERROR_LOG | TEXT | Yes | Error details if failed |
| STARTED_AT | TIMESTAMP_NTZ | Yes | UTC start time |
| COMPLETED_AT | TIMESTAMP_NTZ | Yes | UTC completion time |

### WIKI_ARTICLES -- Wiki article metadata

| Column | Type | Nullable | Description |
|---|---|---|---|
| ID | TEXT | NOT NULL (PK) | UUID-based identifier |
| SLUG | TEXT | NOT NULL | URL-friendly identifier (unique) |
| TITLE | TEXT | NOT NULL | Human-readable title |
| SUMMARY | TEXT | Yes | Brief summary |
| CATEGORY | TEXT | Yes | Topic category (technology, product, strategy, industry, people, process) |
| PARENT_TOPIC | TEXT | Yes | Parent topic slug for hierarchy |
| SOURCE_ARTICLE_IDS | TEXT | Yes | Comma-separated source article IDs |
| TAGS_TEXT | TEXT | Yes | Comma-separated tags |
| CREATED_AT | TIMESTAMP_NTZ | Yes | UTC creation time |
| UPDATED_AT | TIMESTAMP_NTZ | Yes | UTC last update time |

### RAW_DOCS_STAGING -- Staging table for parsed documents

This table uses VARIANT columns for flexibility in extracted data.

| Column | Type | Nullable | Description |
|---|---|---|---|
| FILENAME | TEXT | Yes | Original filename |
| PARSED_CONTENT | TEXT | Yes | Extracted text content |
| DOC_TYPE | TEXT | Yes | Document classification |
| EXTRACTED_FIELDS | VARIANT | Yes | Structured extraction (JSON) |
| TAGS | VARIANT | Yes | AI-generated tags (JSON array) |
| WIKI_TOPICS | VARIANT | Yes | Suggested wiki topics (JSON array) |

## Relationships

```
ARTICLES 1──* ARTICLE_CONTENT    (via ARTICLE_ID)
ARTICLES 1──* ARTICLE_REVISIONS  (via ARTICLE_ID)
ARTICLES *──* ARTICLES           (via ARTICLE_LINKS: SOURCE_ARTICLE_ID, TARGET_ARTICLE_ID)
ARTICLES *──* TAGS               (via ARTICLE_TAGS: ARTICLE_ID, TAG_ID)
ARTICLES 1──* ANNOTATIONS        (via ARTICLE_ID)
CLIENTS  1──* CLIENT_CONTACTS    (via CLIENT_ID)
CLIENTS  1──* TODOS              (via CLIENT_ID)
ARTICLES 1──* TODOS              (via SOURCE_ARTICLE_ID)
```

## Stages

| Stage | Properties | Purpose |
|---|---|---|
| `RAW_DOCS` | Internal, `DIRECTORY = TRUE` | Uploaded raw files (PDFs, docs, etc.) |

## Cortex Search Services

Defined in `scripts/search_services.sql`. Two services index ARTICLE_CONTENT:

| Service | Search Column | Attributes | Filter |
|---|---|---|---|
| `SNOWTS_SEARCH_SERVICE` | `content` | title, source_type, client_name | None (all content) |
| `WIKI_SEARCH_SERVICE` | `content` | title, source_type, client_name, tags_text | `source_type = 'wiki'` |

Both use `TARGET_LAG = '1 hour'` and require the configured warehouse.

## Semantic View

Defined in `scripts/semantic_view.yaml`. Covers 4 tables for text-to-SQL queries:

| Table | Key Metrics |
|---|---|
| WIKI_ARTICLES | ARTICLE_COUNT |
| TODOS | TODO_COUNT, ACTIVE_TODO_COUNT, OVERDUE_COUNT |
| CLIENTS | CLIENT_COUNT |
| PIPELINE_RUNS | RUN_COUNT, TOTAL_FILES_PROCESSED |

Relationship: TODOS -> CLIENTS (many_to_one via CLIENT_ID).

Custom instruction: All TIMESTAMP_NTZ columns store UTC. Do not add date filters unless the user explicitly requests a date range.

## Cortex Agent

Defined in `scripts/agent_spec.yaml`. The agent orchestrates 5 tools:

| Tool | Type | Resource |
|---|---|---|
| `search_wiki` | cortex_search | WIKI_SEARCH_SERVICE |
| `search_all_content` | cortex_search | SNOWTS_SEARCH_SERVICE |
| `query_data` | cortex_analyst_text_to_sql | SNOWTS_SEMANTIC_VIEW |
| `web_search` | web_search | (built-in) |
| `annotate_article` | generic (procedure) | ANNOTATE_WIKI_ARTICLE |

## Stored Procedures

Defined in `scripts/stored_procedures.sql`.

### ANNOTATE_WIKI_ARTICLE(ARTICLE_SLUG VARCHAR, INSTRUCTION VARCHAR) -> VARCHAR

Merges new information into an existing wiki article using AI. Returns JSON:
- Success: `{"ok": true, "slug": "...", "summary": "...", "merged": "..."}`
- Failure: `{"ok": false, "error": "..."}`

Behavior: Joins WIKI_ARTICLES -> ARTICLES -> ARTICLE_CONTENT, calls AI_COMPLETE to merge content, updates all three tables, creates a revision, and logs an annotation.

## Local Folder Structure

These directories exist on the local filesystem alongside the application:

| Directory | Purpose | Contents |
|---|---|---|
| `notes/` | Local markdown notes | `inbox.md`, subdirs: `daily/`, `clients/`, `topics/` |
| `raw/` | Raw documents for processing | PDFs, docs, text files dropped here |
| `wiki/` | Local wiki markdown files | Generated/synced from Snowflake |

## Data Portability

Instances can exchange data via MERGE-based migration. The merge keys ensure idempotent transfers:

| Table | Merge Keys |
|---|---|
| ARTICLES | ID |
| ARTICLE_CONTENT | ID |
| ARTICLE_REVISIONS | ID |
| ARTICLE_LINKS | SOURCE_ARTICLE_ID, TARGET_ARTICLE_ID |
| ARTICLE_TAGS | ARTICLE_ID, TAG_ID |
| CLIENTS | ID |
| CLIENT_CONTACTS | ID |
| TAGS | ID |
| TODOS | ID |
| ANNOTATIONS | ID |
| PIPELINE_RUNS | ID |
| WIKI_ARTICLES | ID |

Migration order (respects foreign key dependencies): CLIENTS, TAGS, ARTICLES, ARTICLE_CONTENT, ARTICLE_REVISIONS, ARTICLE_LINKS, ARTICLE_TAGS, CLIENT_CONTACTS, TODOS, ANNOTATIONS, PIPELINE_RUNS, WIKI_ARTICLES.

## Extension Points

Users MAY extend the data layer in these ways without breaking interoperability:

- Add columns to existing tables (existing columns must remain unchanged)
- Add new tables to the `APP` schema
- Add new stages
- Use VARIANT columns in RAW_DOCS_STAGING for custom extraction fields
- Create additional Cortex Search services
- Add tools to the agent specification

Users MUST NOT:

- Rename or remove existing columns
- Change column types
- Rename tables
- Use a schema other than `APP` for core tables
- Change the merge keys

## Validation Queries

Run these after setup to verify the data layer:

```sql
-- Check all tables exist
SELECT TABLE_NAME FROM {{DB}}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'APP'
ORDER BY TABLE_NAME;
-- Expected: 13 tables

-- Check stage exists
SHOW STAGES LIKE 'RAW_DOCS' IN SCHEMA {{DB}}.APP;

-- Check search services
SHOW CORTEX SEARCH SERVICES IN SCHEMA {{DB}}.APP;
-- Expected: 2 services

-- Check semantic view
SHOW SEMANTIC VIEWS LIKE 'SNOWTS_SEMANTIC_VIEW' IN SCHEMA {{DB}}.APP;

-- Check stored procedure
SHOW PROCEDURES LIKE 'ANNOTATE_WIKI_ARTICLE' IN SCHEMA {{DB}}.APP;

-- Check agent
SHOW AGENTS LIKE 'SNOWTS_AGENT' IN SCHEMA {{DB}}.APP;
```
