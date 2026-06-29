# BUILD.md -- Build and Personalization Guide

## Application Purpose

SnowTS is a personal knowledge management application. It ingests raw documents, meeting notes, and web content, processes them through an AI pipeline, and organizes everything into a searchable wiki with client tracking, to-dos, and an AI agent.

## Application Pattern

**Ingest -> Process -> Organize -> Query -> Act**

1. **Ingest**: Drop files, paste URLs, type quick notes, write in inbox
2. **Process**: AI classifies, extracts entities, generates tags, identifies action items
3. **Organize**: Content routes to articles, wiki, clients, and todos automatically
4. **Query**: Search full-text content, ask the AI agent, run structured queries
5. **Act**: Work through todos, annotate articles, enrich the wiki, track client engagement

## User Interview

Before building, the agent MUST understand the user's workflow. Ask these questions and record the answers.

### Question 1: Note-Taking Style

> How do you take notes today?

Listen for:
- **Freeform markdown**: Prioritize the inbox and quick-note flow
- **Structured templates**: Add template support to note creation
- **Audio/voice**: Add transcription as an ingestion source
- **Bullet journaling**: Emphasize daily note structure with migration
- **Outliner style**: Support nested/indented content natively

### Question 2: Knowledge Organization

> How do you organize knowledge? What structure makes sense to you?

Listen for:
- **Folders/hierarchy**: Emphasize category sidebar, parent-child wiki topics
- **Tags/labels**: Prioritize the tag system, add tag-based navigation
- **Bidirectional links (Zettelkasten)**: Emphasize ARTICLE_LINKS, show backlinks on every page, add graph view
- **PARA method**: Map to Projects (clients), Areas (wiki categories), Resources (wiki), Archive
- **No system / ad-hoc**: Lean on AI auto-organization, minimize manual structure

### Question 3: Task Management

> What does your todo/task workflow look like?

Listen for:
- **GTD (Getting Things Done)**: Add contexts, next actions, someday/maybe to TODOS
- **Kanban**: Prioritize the 4-column board view (backlog/todo/in_progress/done)
- **Priority-based**: Emphasize priority field, sort by urgency
- **Time-blocking**: Add calendar/schedule integration
- **Minimal/no system**: AI-extracted todos with simple accept/reject

### Question 4: Tracked Entities

> What kinds of entities do you track? (clients, projects, people, topics, etc.)

Listen for:
- **Clients/companies**: The default -- CLIENTS table is the primary entity
- **Projects**: May want to add a PROJECTS table or repurpose CLIENTS
- **People/contacts**: Emphasize CLIENT_CONTACTS, may want standalone contact management
- **Research topics**: Wiki-centric, minimize client tracking
- **Everything equally**: Keep the default balanced approach

### Question 5: Tech Stack

> What's your preferred tech stack for the frontend and backend?

Listen for:
- **React/Next.js**: Closest to reference implementation
- **Vue/Nuxt**: Translate component patterns, use Pinia for state
- **Svelte/SvelteKit**: Translate to Svelte stores, simpler component model
- **Python full-stack (Streamlit)**: Single-file app, Snowflake-native deployment option
- **CLI-only**: No frontend -- terminal interface with the agent via API
- **Backend preference**: FastAPI (Python), Express (Node), Go, etc.

### Question 6: Deployment Model

> Do you want a local-first or cloud-first experience?

Listen for:
- **Local-first**: File watcher, SQLite offline queue, local markdown files as source of truth
- **Cloud-first**: Direct Snowflake writes, Streamlit in Snowflake, no local file dependency
- **Hybrid** (default): Local files + Snowflake sync, offline queue for resilience

**MANDATORY STOPPING POINT**: Confirm the user's answers before proceeding. Summarize the profile and ask for approval.

## Build Steps

### Track A: Snowflake-Accelerated

Use this track when the user has a Snowflake account. Leverages `scripts/` directly.

#### A1. Configure Names

Ask the user for:
- Database name (default: `SNOWTS_DB`)
- Warehouse name (default: `SNOWTS_WH`)

#### A2. Create Infrastructure

```sql
CREATE DATABASE IF NOT EXISTS {{DB}};
CREATE SCHEMA IF NOT EXISTS {{DB}}.APP;
CREATE WAREHOUSE IF NOT EXISTS {{WH}}
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 120
  AUTO_RESUME = TRUE;
```

#### A3. Create Tables

Execute `scripts/ddl.sql` with `{{DB}}` and `{{WH}}` replaced. All 13 tables created in order:

ARTICLES, ARTICLE_CONTENT, ARTICLE_REVISIONS, ARTICLE_LINKS, ARTICLE_TAGS, CLIENTS, CLIENT_CONTACTS, TAGS, TODOS, ANNOTATIONS, PIPELINE_RUNS, WIKI_ARTICLES, RAW_DOCS_STAGING.

#### A4. Create Stage

```sql
CREATE STAGE IF NOT EXISTS {{DB}}.APP.RAW_DOCS DIRECTORY = (ENABLE = TRUE);
```

#### A5. Create Search Services

Execute `scripts/search_services.sql` with placeholders replaced.

#### A6. Create Semantic View

Apply `scripts/semantic_view.yaml` with `{{DB}}` replaced:

```sql
CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML('{{DB}}.APP', $$<contents of semantic_view.yaml>$$);
```

#### A7. Create Stored Procedure

Execute `scripts/stored_procedures.sql` with placeholders replaced.

#### A8. Create Agent

Execute the agent DDL using `scripts/agent_spec.yaml` with placeholders replaced:

```sql
CREATE OR REPLACE AGENT {{DB}}.APP.SNOWTS_AGENT
  COMMENT = 'SnowTS knowledge base assistant'
  FROM SPECIFICATION
  $$<contents of agent_spec.yaml>$$;
```

#### A9. Verify

Run the validation queries from DATA.md to confirm all 22 objects exist.

### Track B: General Platform

Use this track when the user wants a non-Snowflake database or wants to understand the abstract contracts.

#### B1. Create Tables

Translate the table definitions from DATA.md to the target database's DDL syntax. Preserve column names and types exactly.

#### B2. Create Search Layer

Replace Cortex Search with:
- **PostgreSQL**: Full-text search with tsvector/tsquery on ARTICLE_CONTENT
- **Elasticsearch**: Index ARTICLE_CONTENT with same field mapping
- **SQLite FTS5**: For local-only deployments
- **Typesense/Meilisearch**: For hosted search

#### B3. Stub AI Services

Replace Snowflake Cortex AI functions with:
- **OpenAI API**: AI_COMPLETE -> ChatCompletion, AI_CLASSIFY -> classification prompt
- **Anthropic API**: Direct Claude calls
- **Local LLMs**: Ollama or similar
- **No AI**: Stub all AI functions to return empty results; manual-only workflow

#### B4. Stub Agent

Replace Cortex Agent with:
- A custom agent loop using the chosen LLM + tool definitions
- Or skip agent entirely for a manual-only experience

## Backend Construction

### API Route Map

The backend exposes these route groups. Implement all of them in the user's preferred framework.

| Group | Base Path | Key Operations |
|---|---|---|
| Status | `/api/status`, `/api/dashboard` | Health check, dashboard data |
| Notes | `/api/notes` | CRUD, inbox processing, smart input (text/URL/file) |
| Pipeline | `/api/pipeline` | Trigger processing, status, file upload, URL ingest |
| Clients | `/api/clients` | CRUD with contacts, articles, todos |
| Todos | `/api/todos` | CRUD, AI context, grouping, archiving |
| Search | `/api/search` | Full-text search with filters |
| Wiki | `/api/wiki` | CRUD, categories, links, history, annotation |
| Agent | `/api/agent` | Chat (single-turn) and stream (SSE) |
| Settings | `/api/settings` | Connection management, setup, migration |
| Activity | `/api/activity` | SSE event stream, history |

Full route details are in the reference implementation at `assets/snowts-v3/SPEC.md`.

### Document Processing Pipeline

The pipeline transforms raw content into structured knowledge:

1. **Parse**: AI_PARSE_DOCUMENT for PDFs, plain read for text/markdown
2. **Classify**: AI_CLASSIFY determines document type
3. **Extract**: AI_EXTRACT pulls structured fields (client name, dates, topics, action items)
4. **Tag**: AI generates tags
5. **Store**: Upsert into ARTICLES + ARTICLE_CONTENT, create ARTICLE_LINKS
6. **Client routing**: Auto-create/link CLIENTS records from extracted client names
7. **Todo extraction**: Create TODOS from extracted action items
8. **Wiki synthesis**: Generate/update WIKI_ARTICLES from processed content

### Data Access Patterns

- All table references use `{{DB}}.APP.TABLE_NAME` (configurable prefix)
- ID generation: UUID v4, truncated to 8 characters (`str(uuid.uuid4())[:8]`)
- Timestamps: UTC TIMESTAMP_NTZ, format `%Y-%m-%dT%H:%M:%S`
- Offline queue: SQLite (or equivalent) for write operations when DB is unreachable
- Connection singleton with keep-alive probe (`SELECT 1`)

## Frontend Construction

Refer to `DESIGN.md` for all visual specifications. Key requirements:

### Pages to Build

| Route | Page | Required Elements |
|---|---|---|
| `/setup` | Onboarding | Step wizard: connection -> names -> create objects -> done |
| `/` | Dashboard | KPI cards, recent items, todo kanban board |
| `/notes` | Notes | File tree sidebar, markdown editor, inbox processing |
| `/wiki` | Wiki | Category sidebar, article viewer/editor, wiki links |
| `/clients` | Clients | Client list with status, contact counts |
| `/clients/:id` | Client Detail | Contacts, related articles, todos |
| `/search` | Search | Full-text search with source_type/client filters |
| `/settings` | Settings | Connection management, object status, data migration |

### Required Components

| Component | Purpose |
|---|---|
| Layout shell | Header nav + toolbar + main content area |
| Agent panel | Sliding chat with streaming responses |
| Quick input | Unified bar for notes, URLs, files |
| Command palette | Cmd+K search and navigation |
| Activity indicator | Real-time pipeline status |

## Personalization Guide

After the interview, adapt the build based on the user's profile:

### Note-Taking Adaptations

| Style | Changes |
|---|---|
| Freeform markdown | Default inbox flow, minimal structure |
| Structured templates | Add template picker to note creation, store templates in wiki |
| Bullet journal | Add daily note auto-creation, migration workflow |
| Outliner | Support nested content, collapse/expand |

### Organization Adaptations

| Style | Changes |
|---|---|
| Folders | Deep category hierarchy in wiki sidebar |
| Tags | Tag cloud navigation, multi-tag filtering |
| Zettelkasten | Backlinks on every page, graph visualization of ARTICLE_LINKS |
| PARA | Rename sidebar sections: Projects, Areas, Resources, Archive |

### Task Management Adaptations

| Style | Changes |
|---|---|
| GTD | Add context field to TODOS, next-actions view, weekly review page |
| Kanban | Default: 4-column board is already built |
| Priority-based | Sort by priority, add urgency indicators |
| Minimal | AI-extracted todos with accept/reject, no manual creation |

### Entity Tracking Adaptations

| Focus | Changes |
|---|---|
| Clients (default) | Standard CLIENTS table and views |
| Projects | Add PROJECT_ID to TODOS, project overview page |
| Research topics | Wiki-centric, minimize client UI, add topic graph |
| People | Expand CLIENT_CONTACTS to standalone entity |

### Tech Stack Adaptations

| Stack | Notes |
|---|---|
| React | Closest to reference; use Zustand, React Router, Tailwind |
| Vue | Pinia for state, Vue Router, Tailwind or UnoCSS |
| Svelte | Svelte stores, SvelteKit routing, Tailwind |
| Streamlit | Single Python app, deploy to Snowflake, use st.chat_message for agent |
| CLI | Rich/Textual TUI, API client for backend, no frontend build step |

## Validation Checklist

Before declaring the build complete:

- [ ] All 13 tables exist with correct column schemas (run DATA.md validation queries)
- [ ] RAW_DOCS stage exists with DIRECTORY enabled
- [ ] Both Cortex Search services respond to queries
- [ ] Semantic view responds to natural language questions
- [ ] Agent responds to chat with tool use (search, query, web search)
- [ ] ANNOTATE_WIKI_ARTICLE procedure merges content correctly
- [ ] Document pipeline processes a test file end-to-end (drop file -> articles + wiki)
- [ ] Frontend renders all pages without errors
- [ ] Keyboard shortcuts work (Cmd+K, Enter to submit)
- [ ] Offline queue stores operations when Snowflake is unreachable
- [ ] Data migration works between two instances (MERGE-based)
