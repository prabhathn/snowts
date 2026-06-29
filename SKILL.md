---
name: snowts-appdef
description: "Build a personal knowledge management application (SnowTS) from an appdef specification. Use for: building SnowTS, personal wiki app, knowledge management app, note-taking app with Snowflake, document processing pipeline, AI-powered wiki. This skill defines the appdef format -- a way to package applications as markdown specs + critical scripts instead of full source code."
---

# SnowTS AppDef

An **appdef** packages an application as markdown specifications and critical scripts instead of full source code. A coding agent reconstructs the application to the user's own style and tech stack.

Every application has two sides:

| Side | What it covers | Freedom |
|---|---|---|
| **Deterministic** | Data schema, DDL, Snowflake objects, stored procedures, agent specs | None -- reproduce exactly |
| **Probabilistic** | UI design, layout, component architecture, workflow, personalization | Full -- adapt to user |

## Package Structure

```
SKILL.md              <-- You are here (entry point)
DATA.md               <-- Rigid data contracts (tables, services, agent)
DESIGN.md             <-- UI philosophy and patterns (advisory)
BUILD.md              <-- Build guide with user interview + personalization
scripts/
  ddl.sql             <-- All table DDL (parameterized)
  search_services.sql <-- Cortex Search definitions
  semantic_view.yaml  <-- Semantic view YAML
  agent_spec.yaml     <-- Cortex Agent specification
  stored_procedures.sql <-- Stored procedure code
assets/
  snowts-v3/          <-- Full reference implementation (read-only)
```

## Workflow

### Step 1: User Interview

**Goal:** Understand the user's workflow before building anything.

**Actions:**
1. **Load** `BUILD.md` and follow the User Interview section
2. Ask the user about their note-taking style, knowledge organization, task management, tracked entities, tech stack preferences, and local-vs-cloud preference
3. Record answers -- they drive all probabilistic decisions in later steps

**Output:** User profile that guides personalization.

**MANDATORY STOPPING POINT**: Do NOT proceed until the interview is complete and the user confirms their preferences.

### Step 2: Data Layer Setup

**Goal:** Create all Snowflake objects exactly per the data contract.

**Actions:**
1. **Load** `DATA.md` for the full contract specification
2. Ask the user for their preferred database name (default: `SNOWTS_DB`) and warehouse name (default: `SNOWTS_WH`)
3. Execute `scripts/ddl.sql` with `{{DB}}` and `{{WH}}` replaced
4. Execute `scripts/search_services.sql` with placeholders replaced
5. Apply `scripts/semantic_view.yaml` via `SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML`
6. Execute `scripts/stored_procedures.sql` with placeholders replaced
7. Apply `scripts/agent_spec.yaml` via `CREATE OR REPLACE AGENT`
8. Verify all objects exist using the validation queries in DATA.md

**If the user is NOT using Snowflake:** Translate the DATA.md contracts to their chosen database. Cortex-specific objects (search services, semantic view, agent) should be stubbed or replaced with equivalents.

**Output:** Complete data layer with all 13 tables, stage, 2 search services, semantic view, stored procedure, and agent.

**MANDATORY STOPPING POINT**: Verify all objects before proceeding.

### Step 3: Backend Construction

**Goal:** Build the API layer that connects the data layer to the frontend.

**Actions:**
1. **Load** `BUILD.md` for the API route map and data access patterns
2. **Load** `DATA.md` for table schemas and relationships
3. Build the backend in the user's preferred framework (from interview)
4. Implement the document processing pipeline (parse, classify, extract, tag, store, route)
5. Implement the AI service layer (Cortex AI functions or alternatives)
6. If stuck, consult `assets/snowts-v3/` for the reference implementation

**Personalization:** Adapt the API structure to the user's workflow preferences from Step 1. For example, if they use Zettelkasten, add bidirectional link management endpoints.

**Output:** Working backend with all API routes.

### Step 4: Frontend Construction

**Goal:** Build the UI guided by design philosophy but adapted to the user's style.

**Actions:**
1. **Load** `DESIGN.md` for layout patterns, color system, and component catalog
2. **Load** `BUILD.md` for page structure and interaction patterns
3. Build the frontend in the user's preferred framework (from interview)
4. Apply design philosophy, not pixel-perfect reproduction
5. If stuck, consult `assets/snowts-v3/` for the reference implementation

**Personalization:** Adapt the UI to match the user's workflow. For example, if they prefer keyboard-driven workflows, prioritize the command palette; if they prefer visual organization, emphasize the wiki graph view.

**Output:** Working frontend with all pages and components.

### Step 5: Validation

**Goal:** Verify the application works end-to-end.

**Validation checklist:**
- All 13 tables exist with correct schemas
- Cortex Search services are operational
- Semantic view responds to natural language queries
- Agent responds to chat messages with tool use
- Document pipeline processes a test file end-to-end
- Frontend renders all pages
- Data contracts from DATA.md are fully satisfied

**If validation fails:** Return to the relevant step with error context. Maximum 3 retry attempts per step.

## Stopping Points

- After Step 1 (interview complete, user confirms preferences)
- After Step 2 (data layer verified)
- After Step 5 (full validation)

## Output

A fully functional personal knowledge management application built to the user's style, with a rigid data layer that ensures interoperability with any other SnowTS instance.
