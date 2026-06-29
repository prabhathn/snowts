from fastapi import APIRouter
import json
from ..db import sf_execute, sf_execute_no_fetch, is_online
from ..models.schemas import TodoUpdate
from ..services.ai import ai_complete
from ..services.config import db_prefix

router = APIRouter(prefix="/api/todos", tags=["todos"])

@router.get("")
async def list_todos():
    if not is_online():
        return {"todos": []}
    try:
        todos = sf_execute(f"""
            SELECT t.*, c.name as client_name
            FROM {db_prefix()}.TODOS t
            LEFT JOIN {db_prefix()}.CLIENTS c ON t.client_id = c.id
            WHERE t.archived_at IS NULL AND t.rejected_at IS NULL
            ORDER BY
                CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'backlog' THEN 2 ELSE 3 END,
                t.due_date NULLS LAST,
                t.created_at DESC
        """)
        for t in todos:
            raw = t.get("tags_text") or ""
            t["tags"] = [s.strip() for s in raw.split(",") if s.strip()] if raw else []
        return {"todos": todos}
    except Exception:
        return {"todos": []}

@router.patch("/{todo_id}")
async def update_todo(todo_id: str, update: TodoUpdate):
    if not is_online():
        return {"error": "offline"}
    updates = []
    params = []
    for field in ["status", "title", "description", "due_date", "priority", "client_id"]:
        val = getattr(update, field, None)
        if val is not None:
            updates.append(f"{field} = %s")
            params.append(val)
    if update.tags is not None:
        updates.append("tags_text = %s")
        params.append(", ".join(update.tags))
    if update.group_name is not None:
        updates.append("group_name = %s")
        params.append(update.group_name if update.group_name else None)
    if update.archived is not None:
        if update.archived:
            updates.append("archived_at = CURRENT_TIMESTAMP()")
        else:
            updates.append("archived_at = NULL")
    if update.rejected is not None:
        if update.rejected:
            updates.append("rejected_at = CURRENT_TIMESTAMP()")
            updates.append("archived_at = CURRENT_TIMESTAMP()")
        else:
            updates.append("rejected_at = NULL")
    if not updates:
        return {"ok": True}
    params.append(todo_id)
    sf_execute_no_fetch(
        f"UPDATE {db_prefix()}.TODOS SET {', '.join(updates)} WHERE id = %s", params
    )
    rows = sf_execute(f"""
        SELECT t.*, c.name as client_name
        FROM {db_prefix()}.TODOS t
        LEFT JOIN {db_prefix()}.CLIENTS c ON t.client_id = c.id
        WHERE t.id = %s
    """, [todo_id])
    if rows:
        raw = rows[0].get("tags_text") or ""
        rows[0]["tags"] = [s.strip() for s in raw.split(",") if s.strip()] if raw else []
    return rows[0] if rows else {}

@router.post("/archive-done")
async def archive_done():
    if not is_online():
        return {"error": "offline"}
    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.TODOS
        SET archived_at = CURRENT_TIMESTAMP()
        WHERE status = 'done' AND archived_at IS NULL
    """)
    return {"ok": True}

@router.post("/unarchive-all")
async def unarchive_all():
    if not is_online():
        return {"error": "offline"}
    sf_execute_no_fetch(f"""
        UPDATE {db_prefix()}.TODOS
        SET archived_at = NULL
        WHERE archived_at IS NOT NULL
    """)
    return {"ok": True}

@router.post("/suggest-groups")
async def suggest_groups():
    if not is_online():
        return {"groups": []}
    try:
        todos = sf_execute(f"""
            SELECT t.id, t.title, t.tags_text, t.priority, c.name as client_name
            FROM {db_prefix()}.TODOS t
            LEFT JOIN {db_prefix()}.CLIENTS c ON t.client_id = c.id
            WHERE t.status = 'backlog' AND t.archived_at IS NULL AND t.rejected_at IS NULL
            ORDER BY t.created_at DESC
        """)
        if not todos:
            return {"groups": []}

        sf_execute_no_fetch(f"""
            UPDATE {db_prefix()}.TODOS SET group_name = NULL
            WHERE status = 'backlog' AND archived_at IS NULL AND rejected_at IS NULL
        """)

        idx_to_id = {}
        task_lines = []
        for i, t in enumerate(todos):
            idx_to_id[str(i)] = t["id"]
            tags = t.get("tags_text") or ""
            client = t.get("client_name") or "no client"
            task_lines.append(f'- #{i}: "{t["title"]}", tags: [{tags}], client: {client}, priority: {t.get("priority", "medium")}')

        tasks_text = "\n".join(task_lines)

        prompt = f"""You are organizing a professional's task backlog. Given these tasks, suggest logical groups that cluster related work together.

Tasks:
{tasks_text}

Rules:
- Create 3-8 groups based on the specific topic, project, or client each task relates to
- Groups should be specific and topical (e.g. "Gitlab Security Review", "Coupa Integration") — NOT generic categories like "Client Deliverables", "Decks & Presentations", "Follow-ups", or "Miscellaneous"
- No group should contain more than 40% of all tasks. If a group is too large, split it into more specific sub-topics
- Every task must belong to exactly one group
- If a task truly doesn't fit any group, put it in a group called "Other"
- Group names should be short (2-4 words), descriptive, and specific to the actual work
- Use the numeric task IDs (e.g. 0, 1, 2) in your response
- Return ONLY valid JSON, no markdown formatting

Return this exact JSON format:
{{"groups": [{{"name": "Group Name", "task_ids": [0, 1, 2]}}]}}"""

        result = ai_complete(prompt, max_tokens=1500)
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[1] if "\n" in result else result[3:]
            result = result.rsplit("```", 1)[0]
        parsed = json.loads(result)

        response_groups = []
        for group in parsed.get("groups", []):
            group_name = group.get("name", "")
            raw_ids = group.get("task_ids", [])
            real_ids = []
            for rid in raw_ids:
                real_id = idx_to_id.get(str(rid))
                if real_id:
                    real_ids.append(real_id)
                    try:
                        sf_execute_no_fetch(
                            f"UPDATE {db_prefix()}.TODOS SET group_name = %s WHERE id = %s",
                            [group_name, real_id]
                        )
                    except Exception:
                        pass
            response_groups.append({"name": group_name, "task_ids": real_ids})

        return {"groups": response_groups}
    except Exception:
        return {"groups": []}

@router.post("/{todo_id}/context")
async def generate_context(todo_id: str):
    if not is_online():
        return {"error": "offline"}

    todo_rows = sf_execute(f"""
        SELECT t.*, c.name as client_name
        FROM {db_prefix()}.TODOS t
        LEFT JOIN {db_prefix()}.CLIENTS c ON t.client_id = c.id
        WHERE t.id = %s
    """, [todo_id])
    if not todo_rows:
        return {"error": "not found"}
    todo = todo_rows[0]

    context_parts = []

    if todo.get("source_article_id"):
        article_rows = sf_execute(f"""
            SELECT ac.title, ac.content, ac.client_name, ac.tags_text
            FROM {db_prefix()}.ARTICLE_CONTENT ac
            WHERE ac.article_id = %s
        """, [todo["source_article_id"]])
        if article_rows:
            src = article_rows[0]
            content_preview = (src.get("content") or "")[:3000]
            context_parts.append(f"Source note ({src.get('title', 'Untitled')}):\n{content_preview}")

    client_name = todo.get("client_name")
    if client_name:
        client_notes = sf_execute(f"""
            SELECT ac.title, LEFT(ac.content, 1500) as content
            FROM {db_prefix()}.ARTICLE_CONTENT ac
            WHERE LOWER(ac.client_name) = LOWER(%s)
            ORDER BY ac.id DESC
            LIMIT 5
        """, [client_name])
        for cn in client_notes:
            if cn.get("article_id") != todo.get("source_article_id"):
                context_parts.append(f"Related note ({cn.get('title', 'Untitled')}):\n{cn.get('content', '')}")

    if not context_parts:
        context_parts.append("No related notes found.")

    background = "\n\n---\n\n".join(context_parts)
    prompt = f"""You are helping a professional understand the context behind a task in their knowledge base.

Task title: {todo['title']}
Client: {client_name or 'None'}
Priority: {todo.get('priority', 'medium')}

Here are relevant notes from the knowledge base:

{background}

Write a concise context summary (3-5 sentences) that explains:
- Why this task exists and what it's about
- Any key details, deadlines, or people involved
- What needs to happen to complete it

Be specific and reference actual details from the notes. Do NOT repeat the task title as-is. Return only the context paragraph, no headers or labels."""

    try:
        context_text = ai_complete(prompt, max_tokens=500)
        context_text = context_text.strip()
    except Exception:
        context_text = "Unable to generate context at this time."

    sf_execute_no_fetch(
        f"UPDATE {db_prefix()}.TODOS SET description = %s WHERE id = %s",
        [context_text, todo_id]
    )

    rows = sf_execute(f"""
        SELECT t.*, c.name as client_name
        FROM {db_prefix()}.TODOS t
        LEFT JOIN {db_prefix()}.CLIENTS c ON t.client_id = c.id
        WHERE t.id = %s
    """, [todo_id])
    if rows:
        raw = rows[0].get("tags_text") or ""
        rows[0]["tags"] = [s.strip() for s in raw.split(",") if s.strip()] if raw else []
    return rows[0] if rows else {}
