# SnowTS AppDef

SnowTS is a note-taking and knowledge graph application built on Snowflake, packaged as an **appdef** — a new specification format that allows a coding agent to reconstruct a fully customized application through a collaborative interview process.

## What is an AppDef?

An appdef (application definition) packages an application as markdown specifications and critical scripts instead of shipping full source code. It splits the application into two sides:

- **Deterministic** — Data schema, DDL, Snowflake objects, stored procedures, and agent specifications are reproduced exactly. This ensures any instance built from the same appdef can exchange data with any other.
- **Probabilistic** — UI, tech stack, layout, and workflow are freely adapted by the coding agent based on the user's preferences and answers to an interview.

This means you can share the appdef with anyone. They get a custom-built application tailored to how they work, while maintaining full interoperability with other users on the same data contracts.

## How It Works

1. **User Interview** — The coding agent asks about your note-taking style, preferred organization, task management needs, entity types, tech stack, and deployment target.
2. **Data Layer Setup** — 13 tables, a stage, 2 Cortex Search services, a semantic view, a stored procedure, and a Cortex Agent are created exactly as specified.
3. **Backend Construction** — API routes and services are built to match the data layer, adapted to your chosen tech stack.
4. **Frontend Construction** — UI is built to match your preferences (keyboard-centric, minimal, dense, etc.) using your chosen framework.
5. **Validation** — The agent verifies the build against the data contracts and runs validation queries.

## Repository Structure

```
SKILL.md          Entry point — defines the appdef workflow and agent instructions
DATA.md           Rigid data contract (13 tables, search services, agent spec)
DESIGN.md         Advisory UI/UX design system (colors, typography, components)
BUILD.md          Build guide with user interview and personalization tracks
scripts/          SQL scripts (DDL, stored procedures, search services, semantic view, agent spec)
assets/snowts-v3/ Reference implementation (React + FastAPI + Snowflake)
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| Deterministic side | Schema, DDL, Snowflake objects — must be reproduced exactly |
| Probabilistic side | UI, layout, tech stack — freely adapted to user preferences |
| Reference implementation | A working example in `assets/` for consultation, not cloning |
| Data portability | MERGE-key based migration ensures instances can exchange data |
| Extension rules | Additive-only changes allowed — never remove or rename contract columns |

## What Gets Built

A SnowTS instance includes:

- **13 Snowflake tables** — Articles, content, revisions, links, tags, clients, contacts, todos, annotations, pipeline runs, wiki articles, and staging
- **Cortex Search services** — Full-text search over notes and wiki content
- **Semantic view** — Natural language querying over your knowledge base
- **Cortex Agent** — AI assistant with 5 tools for search, annotation, summarization, and more
- **Document pipeline** — Ingest, process, organize, query, and act on your notes
- **Customized UI** — Built to your style (React, Svelte, whatever you prefer)

## Usage

To build SnowTS from this appdef, open the repository with a coding agent (e.g., Cortex Code) and invoke the skill defined in `SKILL.md`. The agent will guide you through the interview and build process.

## Requirements

- Snowflake account with Cortex AI enabled
- Snow CLI configured with a valid connection
- Python 3.11+ and Node 18+ (for the reference implementation stack, or equivalent for your chosen stack)
