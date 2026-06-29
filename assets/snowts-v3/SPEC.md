# SnowTS — Product & Architecture Spec

SnowTS is a personal knowledge-management application built on Snowflake. It ingests raw documents, meeting notes, and web content, processes them through an AI pipeline, and organizes everything into a searchable wiki with client tracking, to-dos, and an AI agent.

## Architecture Overview

```
┌─────────────────────────────┐      ┌──────────────────────────┐
│  React SPA (Vite + TS)      │◄────►│  FastAPI Backend (Python) │
│  localhost:5173              │ REST │  localhost:8000           │
└─────────────────────────────┘      └────────────┬─────────────┘
                                                  │
                                     ┌────────────▼─────────────┐
                                     │  Snowflake Account        │
                                     │  ┌──────────────────────┐ │
                                     │  │ {DB}.APP schema      │ │
                                     │  │  Tables, Stages      │ │
                                     │  │  Cortex Search (x2)  │ │
                                     │  │  Semantic View        │ │
                                     │  │  Agent + Procedure    │ │
                                     │  └──────────────────────┘ │
                                     └───────────────────────────┘
```

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand (state), React Router v6
- **Backend**: FastAPI + Uvicorn, Python 3.11+, snowflake-connector-python
- **Database**: Snowflake (configurable DB name, always `APP` schema)
- **AI**: Snowflake Cortex AI functions (`AI_COMPLETE`, `AI_CLASSIFY`, `AI_EXTRACT`, `AI_PARSE_DOCUMENT`), Cortex Agent, Cortex Search

## First-Time Setup Flow

1. **`setup.sh`** — Installs Python venv, Node dependencies. No Snowflake interaction.
2. **`start.sh`** — Launches backend (port 8000) and frontend (port 5173).
3. **Onboarding Wizard** — On first load, the app redirects to `/setup`:
   - **Step 1**: Pick a Snowflake connection from `~/.snowflake/connections.toml`, test it.
   - **Step 2**: Choose database name (default `SNOWTS_DB`) and warehouse name (default `SNOWTS_WH`).
   - **Step 3**: Creates all Snowflake objects (DB, schema, warehouse, 13 tables, stage, 2 search services, semantic view, stored procedure, agent).
   - **Step 4**: Done. Redirects to dashboard.

Config is stored in `app/backend/config.json`. The `setup_complete` flag gates the redirect.

## Configurable Database Name

All SQL references use `db_prefix()` (returns `{DB_NAME}.APP`) from `app/backend/services/config.py`. DDL templates in `setup.py` use `SNOWTS_DB` as a placeholder, resolved at runtime via `_resolve(sql)`. This allows multiple independent instances on the same Snowflake account.

## Snowflake Objects

### Tables (in `{DB}.APP`)

| Table | Purpose |
|---|---|
| ARTICLES | Master article registry (notes, raw docs, wiki) |
| ARTICLE_CONTENT | Full-text content for search indexing |
| ARTICLE_REVISIONS | Version history snapshots |
| ARTICLE_LINKS | Directed graph of article cross-references |
| ARTICLE_TAGS | Article-to-tag join table |
| CLIENTS | Client/company records |
| CLIENT_CONTACTS | Contact people per client |
| TAGS | Tag registry (topic, client, person, technology) |
| TODOS | Action items with status, priority, groups |
| ANNOTATIONS | AI annotation records on articles |
| PIPELINE_RUNS | Processing pipeline execution log |
| WIKI_ARTICLES | Wiki article metadata (slug, category, summary) |
| RAW_DOCS_STAGING | Staging table for parsed document content |

### Other Objects

| Object | Type | Purpose |
|---|---|---|
| `RAW_DOCS` | Stage (with DIRECTORY) | Internal stage for uploaded raw files |
| `SNOWTS_SEARCH_SERVICE` | Cortex Search | Full-text search over all ARTICLE_CONTENT |
| `WIKI_SEARCH_SERVICE` | Cortex Search | Search filtered to source_type='wiki' |
| `SNOWTS_SEMANTIC_VIEW` | Semantic View | Structured queries over WIKI_ARTICLES, TODOS, CLIENTS, PIPELINE_RUNS |
| `ANNOTATE_WIKI_ARTICLE` | Stored Procedure | AI-powered article merge/annotation |
| `SNOWTS_AGENT` | Cortex Agent | Orchestrates search, query, web search, and annotation tools |

### Agent Tools

| Tool | Type | Description |
|---|---|---|
| `search_wiki` | cortex_search | Search wiki articles |
| `search_all_content` | cortex_search | Search all source material |
| `query_data` | cortex_analyst | Text-to-SQL over semantic view |
| `web_search` | web_search | External web search |
| `annotate_article` | procedure (generic) | Merge new content into wiki articles |

## Backend API Routes

### Core (`main.py`)
- `GET /api/status` — App health, counts, `setup_complete` flag
- `GET /api/dashboard` — Recent clients, meetings, wiki articles

### Notes (`/api/notes`)
- `GET /notes` — List all notes
- `GET /notes/inbox` — Get inbox content
- `PUT /notes/inbox` — Save inbox
- `POST /notes/inbox/process` — AI-classify and route inbox content
- `GET /notes/inbox/log` — Processing history
- `GET /notes/{path}` — Read note
- `PUT /notes/{path}` — Save note
- `POST /notes/{path}/annotate` — AI annotate a note
- `POST /notes/quick` — Create quick note
- `POST /notes/smart` — Smart input (text, URL, or files)

### Pipeline (`/api/pipeline`)
- `POST /pipeline/run` — Trigger document processing pipeline
- `GET /pipeline/status` — Pipeline run history
- `GET /pipeline/raw-files` — Pending/processed file lists
- `POST /pipeline/upload-raw` — Upload files to raw/
- `POST /pipeline/ingest-url` — Fetch and save URL content

### Clients (`/api/clients`)
- `GET /clients` — List clients with contact counts
- `GET /clients/{id}` — Client detail with contacts, articles, todos
- `PUT /clients/{id}` — Update client fields
- `PATCH /clients/{id}` — Rename client
- `DELETE /clients/{id}` — Delete client and associated data
- `POST /clients/rename-by-file` — Rename by file path

### Todos (`/api/todos`)
- `GET /todos` — List all todos with client names
- `PATCH /todos/{id}` — Update todo fields
- `POST /todos/{id}/context` — AI-generate context for a todo
- `POST /todos/suggest-groups` — AI suggest task groupings
- `POST /todos/archive-done` — Archive completed todos

### Search (`/api/search`)
- `GET /search?q=...` — Cortex Search with optional source_type/client filters

### Wiki (`/api/wiki`)
- `GET /wiki` — List wiki articles (optional category/tag filters)
- `GET /wiki/index` — Articles grouped by category
- `GET /wiki/categories` — Category counts
- `GET /wiki/recent` — Recently updated
- `GET /wiki/{slug}` — Full article with content
- `PUT /wiki/{slug}` — Save article content
- `POST /wiki/{slug}/annotate` — AI annotate article
- `GET /wiki/{slug}/links` — Incoming/outgoing links
- `GET /wiki/{slug}/history` — Revisions and annotations

### Agent (`/api/agent`)
- `POST /agent/chat` — Single-turn agent response
- `POST /agent/stream` — SSE streaming agent with tool use

### Settings (`/api/settings`)
- `GET /settings/connections` — List Snowflake connections
- `POST /settings/connection` — Switch active connection
- `GET /settings/setup-complete` — Check if onboarding is done
- `POST /settings/test-connection` — Test a connection
- `POST /settings/setup-with-config` — Run full setup with config
- `GET /settings/status` — Object existence checklist
- `POST /settings/setup` — Create all objects (legacy)
- `POST /settings/migrate/preflight` — Migration preflight check
- `POST /settings/migrate` — Cross-connection data migration

### Activity (`/api/activity`)
- `GET /activity/stream` — SSE stream for real-time pipeline events
- `GET /activity/history` — Historical events and batches

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/setup` | Onboarding | 4-step setup wizard (outside Layout) |
| `/` | Dashboard | Overview with recent clients, meetings, wiki |
| `/notes` | Notes | File-tree sidebar, markdown editor, inbox processing |
| `/notes/:path` | Notes | Specific note open |
| `/wiki` | Wiki | Category sidebar, article viewer/editor, wiki links |
| `/wiki/:slug` | Wiki | Specific article |
| `/clients` | Clients | Client list with engagement status |
| `/clients/:id` | ClientDetail | Contacts, related articles, todos |
| `/search` | Search | Full-text search with filters |
| `/settings` | Settings | Connection management, object status, migration |

### Key Components
- **Layout** — Header nav, toolbar, agent panel (resizable), quick input bar
- **AgentPanel** — Sliding chat panel with streaming, wiki link rendering, web search toggle, save-as-note
- **QuickInput** — Unified input bar for notes, URLs, files
- **ActivityToolbar** — Real-time pipeline status indicator
- **CommandPalette** — Cmd+K search/navigation

## Document Processing Pipeline

1. Files placed in `raw/` directory (or uploaded via UI)
2. File watcher detects changes, triggers pipeline
3. Pipeline stages:
   - **Parse**: `AI_PARSE_DOCUMENT` for PDFs, plain read for text/markdown
   - **Classify**: `AI_CLASSIFY` determines document type
   - **Extract**: `AI_EXTRACT` pulls structured fields (client name, dates, topics, action items)
   - **Tag**: AI generates tags
   - **Store**: Upsert into ARTICLES, ARTICLE_CONTENT, ARTICLE_LINKS
   - **Client routing**: Auto-create/link client records
   - **Todo extraction**: Create todos from action items
   - **Wiki synthesis**: Generate/update wiki articles from processed content
4. Activity events stream to frontend in real-time via SSE

## Local File Structure

```
snowts-v3/
├── app/
│   ├── backend/
│   │   ├── main.py              # FastAPI app, lifespan, status/dashboard
│   │   ├── db.py                # Snowflake connection singleton, offline queue
│   │   ├── config.json          # Runtime config (created by onboarding)
│   │   ├── routes/              # API route handlers
│   │   │   ├── notes.py, pipeline.py, clients.py, todos.py
│   │   │   ├── search.py, settings.py, wiki.py, agent.py, activity.py
│   │   └── services/            # Business logic
│   │       ├── config.py        # Configurable DB/WH names
│   │       ├── setup.py         # DDL templates, object creation, migration
│   │       ├── pipeline.py      # Document processing pipeline
│   │       ├── notes.py         # Note/inbox processing
│   │       ├── wiki.py          # Wiki CRUD and synthesis
│   │       ├── ai.py            # Cortex AI wrappers, agent streaming
│   │       ├── shared.py        # Common SQL helpers
│   │       ├── activity.py      # Event tracking/SSE
│   │       ├── watcher.py       # File system watcher
│   │       └── url_ingest.py    # URL content fetching
│   └── frontend/
│       ├── src/
│       │   ├── App.tsx          # Router with setup guard
│       │   ├── api/client.ts    # API client
│       │   ├── store/index.ts   # Zustand store
│       │   ├── types/index.ts   # TypeScript types
│       │   ├── pages/           # Page components
│       │   ├── components/      # Shared components
│       │   └── contexts/        # React contexts
│       ├── package.json
│       └── vite.config.ts
├── notes/                       # Local markdown notes
│   ├── inbox.md
│   ├── daily/, clients/, topics/
├── wiki/                        # Local wiki markdown files
├── raw/                         # Raw documents for processing
├── docs/                        # Documentation
├── setup.sh                     # Dev environment setup
├── start.sh                     # Start dev servers
└── README.md
```
