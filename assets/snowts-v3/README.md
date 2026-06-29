# SnowTS

A personal knowledge-management app built on Snowflake. Ingest documents, meeting notes, and web content. An AI pipeline classifies, extracts, and organizes everything into a searchable wiki with client tracking, to-dos, and a Cortex AI agent.

## Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Snowflake account** with a connection configured in `~/.snowflake/connections.toml`
- **Snow CLI** (optional, for stage uploads) — [Install](https://developers.snowflake.com/snowflake-cli/)

### Snowflake Connection

Create `~/.snowflake/connections.toml` if it doesn't exist:

```toml
[myconnection]
account = "your-account"
user = "your-user"
authenticator = "externalbrowser"
```

See [Snowflake CLI docs](https://docs.snowflake.com/en/developer-guide/snowflake-cli/connecting/specify-credentials) for all auth options.

## Quick Start

```bash
# 1. Install dependencies
./install.sh

# 2. Start the app
./start.sh

# 3. Open http://localhost:5173
#    The setup wizard will walk you through Snowflake configuration.
```

## What the Setup Wizard Creates

On first launch, the app guides you through:

1. **Snowflake connection** — Pick from your connections.toml
2. **Database & warehouse names** — Defaults to `SNOWTS_DB` / `SNOWTS_WH` (customizable)
3. **Object creation** — Creates:
   - Database + `APP` schema
   - XS warehouse (auto-suspend 120s)
   - 13 tables (articles, wiki, clients, todos, etc.)
   - Internal stage (`RAW_DOCS`)
   - 2 Cortex Search services
   - Semantic view for structured queries
   - Stored procedure for AI annotations
   - Cortex Agent with search, query, web search, and annotation tools

## Development

```bash
# Backend only (port 8000)
SNOWFLAKE_CONNECTION_NAME=myconnection .venv/bin/python -m uvicorn app.backend.main:app --reload --port 8000

# Frontend only (port 5173)
cd app/frontend && npm run dev
```

## Architecture

See [SPEC.md](SPEC.md) for full architecture documentation.

- **Frontend**: React + TypeScript + Vite + Tailwind
- **Backend**: FastAPI + Python
- **Database**: Snowflake with configurable DB name
- **AI**: Snowflake Cortex (AI_COMPLETE, AI_CLASSIFY, AI_EXTRACT, Cortex Agent)
