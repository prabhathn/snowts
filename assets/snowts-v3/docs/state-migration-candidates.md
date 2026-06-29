# Snowts: In-Memory & Local State — Migration Candidates

> Items that currently live outside Snowflake and would benefit from moving to
> Snowflake Postgres (or Snowflake tables) for durability and multi-device access.

---

## 1. Inbox Processing Log

- **Location:** `app/backend/services/notes.py:21` — `_inbox_log: list[dict]`
- **What:** Up to 50 recent inbox processing results (id, timestamp, preview, status, AI classification, routed destinations, errors)
- **Lost on restart:** Yes
- **Priority:** High — this is the only record of what happened when a note was processed
- **Target table:** `INBOX_LOG (id, timestamp, preview, status, classification VARIANT, routed VARIANT, error TEXT, created_at)`

## 2. Quick-Note Processing Queue

- **Location:** `app/backend/services/notes.py:17` — `_note_queue: queue.Queue`
- **What:** Pending quick notes waiting for background AI classification (text, daily_path, timestamp)
- **Lost on restart:** Yes — note text is saved to daily .md, but AI classification/routing/indexing never happens
- **Priority:** High — silent data loss
- **Target table:** `NOTE_QUEUE (id, text, daily_path, timestamp, status, created_at)`

## 3. Active Pipeline Run Tracker

- **Location:** `app/backend/routes/pipeline.py:13` — `_active_run: dict`
- **What:** Current/last pipeline run status (id, status, files_processed, error_log, timestamps)
- **Lost on restart:** Yes — can cause duplicate pipeline runs after crash
- **Priority:** Medium — historical runs already stored in `PIPELINE_RUNS` table, but active tracking is not
- **Target table:** Already partially covered by `PIPELINE_RUNS`; add an `is_active` flag or use a separate lock table

## 4. SQLite Offline Queue

- **Location:** `app/backend/db.py:13,72-101` — `offline_queue.db`
- **What:** Queued write operations when Snowflake is unreachable (note indexing, todo creation, etc.)
- **Lost on restart:** No (local file), but machine-bound with no replication
- **Priority:** Medium — works fine for single machine, but won't sync across devices
- **Target table:** `OFFLINE_QUEUE (id, action_type, payload VARIANT, status, created_at)` — though this one is tricky since it exists *because* Snowflake is unreachable

## 5. File Watcher State

- **Location:** `app/backend/services/watcher.py:19-56` — `seen: set`, `batch: list`
- **What:** Set of filenames already detected in `raw/`, plus files in the debounce window
- **Lost on restart:** Yes — but re-populated from disk on startup; low practical impact
- **Priority:** Low
- **Target table:** Not strictly needed — pipeline already tracks processed files

## 6. User Connection Choice

- **Location:** `app/backend/db.py:16-17` — `_connection_name: str`
- **What:** The user's active Snowflake connection name (if switched via UI)
- **Lost on restart:** Yes — falls back to env var
- **Priority:** Low — env var is the expected config mechanism
- **Target:** Local config file or env var (not a DB table)

## 7. Local Filesystem (Notes, Wiki, Raw Docs)

- **Location:** `notes/`, `wiki/`, `raw/` directories
- **What:** All note content, wiki articles, uploaded/ingested documents — this is the **source of truth**
- **Lost on restart:** No, but not replicated or backed up
- **Priority:** High for durability, but large architectural change
- **Target tables:**
  - `NOTE_FILES (id, path, content TEXT, created_at, updated_at)` — or use Snowflake stage
  - `WIKI_FILES (id, slug, content TEXT, created_at, updated_at)` — or keep synced with existing `WIKI_ARTICLES`
  - `RAW_DOCUMENTS` — already partially covered by `RAW_DOCS_STAGING`; could store content in stage

---

## Migration Notes

- Items 1-3 are straightforward table migrations — swap in-memory structures for DB reads/writes
- Item 4 (offline queue) is inherently a local fallback; consider keeping SQLite but adding a sync-on-reconnect mechanism
- Item 7 is the biggest lift — requires deciding whether files live in Snowflake (stages or tables) with local cache, or stay local with better Snowflake sync
- Snowflake Postgres is a good fit for items 1-3 since they benefit from relational queries and durability without needing Snowflake-specific features (AI functions, stages, etc.)
