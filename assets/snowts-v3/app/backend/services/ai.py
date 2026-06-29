import json
import re
from pathlib import Path
from typing import Generator

import requests

from ..db import sf_execute, sf_execute_no_fetch, is_online, gen_id, get_snowflake_conn
from .config import db_prefix, db_name

CORTEX_MODEL = "claude-sonnet-4-6"
SUMMARIZE_THRESHOLD = 4000


def ai_complete(prompt: str, max_tokens: int = 2000) -> str:
    rows = sf_execute(
        f"SELECT AI_COMPLETE('{CORTEX_MODEL}', %s) AS result",
        [prompt]
    )
    raw = rows[0]["result"] if rows else ""
    if raw.startswith('"') and raw.endswith('"'):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return raw


def ai_summarize(text: str) -> str:
    prompt = f"Summarize the following text concisely:\n\n{text[:8000]}"
    return ai_complete(prompt, max_tokens=500)


def _parse_json(raw: str) -> dict:
    clean = raw.strip()
    fenced = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', clean)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            clean = fenced.group(1)
    m = re.search(r'\{[\s\S]*\}', clean)
    if not m:
        return json.loads(clean)
    text = m.group()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    text = re.sub(r',\s*}', '}', text)
    text = re.sub(r',\s*]', ']', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m2 = re.search(r'\{[\s\S]*', clean)
    repaired = m2.group().rstrip() if m2 else text.rstrip()
    repaired = repaired.rstrip(',')
    stack = []
    in_string = False
    escape = False
    for ch in repaired:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']'):
            if stack:
                stack.pop()
    if in_string:
        repaired += '"'
    repaired = repaired.rstrip().rstrip(',')
    repaired += ''.join(reversed(stack))
    repaired = re.sub(r',\s*}', '}', repaired)
    repaired = re.sub(r',\s*]', ']', repaired)
    return json.loads(repaired)


def classify_note(text: str) -> dict:
    if not is_online():
        return {"client": None, "tags": [], "todos": [], "route": "daily"}

    prompt = f"""Analyze this note and return a JSON object with:
- "client": the client/company name if this note is about a specific client, or null
- "tags": array of topic tags (max 5), lowercase
- "todos": array of action items found (each with "title" and "due_date" if inferrable, otherwise null). ONLY include items that have a clear action step (verb + object) or a specific deadline. Do NOT include vague observations, opinions, or general notes.
- "route": one of "client", "topic", or "daily" - where this note should be filed

Note text:
{text}

Return ONLY valid JSON, no other text."""

    try:
        result = ai_complete(prompt)
        return _parse_json(result)
    except Exception:
        return {"client": None, "tags": [], "todos": [], "route": "daily"}


def process_daily_note(text: str, date_str: str) -> dict:
    if not is_online():
        return {"sections": [], "todos": [], "tags": []}

    input_text = text
    if len(text) > SUMMARIZE_THRESHOLD:
        try:
            input_text = ai_summarize(text)
        except Exception:
            input_text = text[:SUMMARIZE_THRESHOLD]

    prompt = f"""You are an AI assistant that organizes raw meeting notes and daily jottings.
Given the text below from a daily note dated {date_str}, extract structured sections.

Return a JSON object with:
- "sections": array of distinct topics/meetings found, each with:
  - "client": company/client name if applicable, or null
  - "summary": 2-4 sentence summary of what was discussed/noted about this topic
  - "key_points": array of the most important bullet points (max 5)
  - "contacts": array of people mentioned, each with "name" and "role" (or null)
  - "tags": array of topic tags (max 3), lowercase
- "todos": array of ONLY clearly actionable items found across the entire note, each with:
  - "title": clear actionable description starting with a verb (e.g. "Send proposal to X", "Follow up on Y by Friday")
  - "due_date": ISO date or relative like "Friday", or null
  - "priority": "low", "medium", or "high"
  - "client": which client this todo relates to, or null
  IMPORTANT: Only extract items that have a clear action step or deadline. Do NOT extract vague observations, opinions, random snippets, or general discussion points as todos. Each todo must be something the user needs to DO.
- "tags": array of overall tags for the entire note (max 5), lowercase

Keep summaries and key_points concise to minimize response size.

Note text:
{input_text}

Return ONLY valid JSON, no other text."""

    try:
        result = ai_complete(prompt, max_tokens=6000)
        return _parse_json(result)
    except Exception:
        return {"sections": [], "todos": [], "tags": []}


def agent_run(prompt: str) -> str:
    if not is_online():
        return ""
    request_body = json.dumps({
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "stream": False
    })
    rows = sf_execute(
        f"SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN('{db_prefix()}.SNOWTS_AGENT', %s)) AS resp",
        [request_body]
    )
    if not rows or not rows[0].get("resp"):
        return ""
    resp = rows[0]["resp"]
    if isinstance(resp, str):
        try:
            resp = json.loads(resp)
        except (json.JSONDecodeError, TypeError):
            return resp
    content_parts = resp.get("content", []) if isinstance(resp, dict) else []
    texts = [p.get("text", "") for p in content_parts if isinstance(p, dict) and p.get("type") == "text"]
    return "\n".join(texts)


def agent_run_stream(prompt: str, tool_choice: dict | None = None) -> Generator[dict, None, None]:
    if not is_online():
        yield {"event": "error", "data": {"message": "Snowflake offline"}}
        return

    conn = get_snowflake_conn()
    if conn is None:
        yield {"event": "error", "data": {"message": "No connection"}}
        return

    host = conn.host.replace("_", "-")
    token = conn.rest.token

    url = f"https://{host}/api/v2/databases/{db_name()}/schemas/APP/agents/SNOWTS_AGENT:run"
    headers = {
        "Authorization": f'Snowflake Token="{token}"',
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    body = {
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "stream": True,
    }
    if tool_choice:
        body["tool_choice"] = tool_choice

    try:
        resp = requests.post(url, headers=headers, json=body, stream=True, timeout=300)
        resp.encoding = "utf-8"
        if resp.status_code != 200:
            yield {"event": "error", "data": {"message": f"HTTP {resp.status_code}: {resp.text[:200]}"}}
            return

        event_type = None
        data_buf = ""
        for line in resp.iter_lines(decode_unicode=True):
            if line is None:
                continue
            if line.startswith("event: "):
                event_type = line[7:].strip()
                data_buf = ""
            elif line.startswith("data: "):
                data_buf += line[6:]
            elif line == "" and event_type and data_buf:
                try:
                    data = json.loads(data_buf)
                except (json.JSONDecodeError, TypeError):
                    data = {"raw": data_buf}
                if event_type != "done":
                    yield {"event": event_type, "data": data}
                event_type = None
                data_buf = ""
    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}


def process_annotation(note_content: str, annotation: str) -> dict:
    if not is_online():
        return {"merged": note_content + f"\n\n---\n\n{annotation}\n", "summary": "Appended (offline)"}

    agent_prompt = f"""I need to enrich a wiki article with new information. Here is the task:

EXISTING ARTICLE (Markdown):
---
{note_content[:6000]}
---

ANNOTATION / NEW INFORMATION:
---
{annotation[:2000]}
---

First, search the wiki and source content for related material that could add depth. Then merge the annotation and any found context into the article.

Rules:
- Preserve ALL existing content and structure
- Weave the new information into the relevant sections where it fits contextually
- If the annotation doesn't fit any existing section, add a new section for it
- Keep the same Markdown formatting style (headings, lists, bold, etc.)
- Do NOT remove or summarize away any existing detail
- If the annotation contradicts existing info, keep both but note the update
- Use [[topic-slug|Display Text]] format for cross-references to related wiki topics (e.g. [[ai-safety|AI safety concerns]])

Return a JSON object with:
- "merged": the full updated article content in Markdown
- "summary": a one-sentence description of what changed

Return ONLY valid JSON, no other text."""

    try:
        result = agent_run(agent_prompt)
        if result:
            parsed = _parse_json(result)
            if "merged" in parsed:
                return parsed
    except Exception:
        pass

    prompt = f"""You are an AI assistant that merges new annotations into existing notes.

Given an existing note (in Markdown) and a new annotation from the user, produce an updated version of the note that intelligently incorporates the new information.

Rules:
- Preserve ALL existing content and structure
- Weave the new information into the relevant sections where it fits contextually
- If the annotation doesn't fit any existing section, add a new section for it
- Keep the same Markdown formatting style (headings, lists, bold, etc.)
- Do NOT remove or summarize away any existing detail
- If the annotation contradicts existing info, keep both but note the update
- Keep it concise — don't add filler text

Return a JSON object with:
- "merged": the full updated note content in Markdown
- "summary": a one-sentence description of what changed (e.g. "Added pricing details to the Q2 review section")

Existing note:
---
{note_content[:6000]}
---

New annotation:
---
{annotation[:2000]}
---

Return ONLY valid JSON, no other text."""

    try:
        result = ai_complete(prompt, max_tokens=4000)
        parsed = _parse_json(result)
        if "merged" not in parsed:
            return {"merged": note_content + f"\n\n---\n\n{annotation}\n", "summary": "Appended (parse error)"}
        return parsed
    except Exception:
        return {"merged": note_content + f"\n\n---\n\n{annotation}\n", "summary": "Appended (error)"}

