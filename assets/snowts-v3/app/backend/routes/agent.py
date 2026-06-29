import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.ai import agent_run, agent_run_stream
from ..services import wiki as wiki_service

router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentContext(BaseModel):
    page: Optional[str] = None
    slug: Optional[str] = None
    client_id: Optional[str] = None
    note_path: Optional[str] = None


class AgentChatRequest(BaseModel):
    message: str
    context: Optional[AgentContext] = None
    web_search: bool = True


def _build_context_prefix(ctx: Optional[AgentContext]) -> str:
    if not ctx or not ctx.page:
        return ""

    if ctx.page == "wiki" and ctx.slug:
        article = wiki_service.get_wiki_article(ctx.slug)
        if article:
            return f'[Context: Wiki article "{article["title"]}" ({ctx.slug})]\n\n'

    if ctx.page == "client" and ctx.client_id:
        return f'[Context: Viewing client profile (id: {ctx.client_id})]\n\n'

    if ctx.page == "note" and ctx.note_path:
        return f'[Context: Viewing note at {ctx.note_path}]\n\n'

    if ctx.page == "dashboard":
        return "[Context: User is on the dashboard / home page]\n\n"

    if ctx.page == "search":
        return "[Context: User is on the search page]\n\n"

    return ""


@router.post("/chat")
async def agent_chat(req: AgentChatRequest):
    try:
        context_prefix = _build_context_prefix(req.context)
        response = agent_run(context_prefix + req.message)

        article_updated = None
        slug = req.context.slug if req.context else None
        if slug:
            updated_article = wiki_service.get_wiki_article(slug)
            if updated_article:
                article_updated = {
                    "slug": slug,
                    "content": updated_article.get("content", ""),
                    "title": updated_article.get("title", ""),
                }

        return {"ok": True, "response": response, "article_updated": article_updated}
    except Exception as e:
        return {"ok": False, "error": str(e), "response": ""}


@router.post("/stream")
async def agent_stream(req: AgentChatRequest):
    context_prefix = _build_context_prefix(req.context)
    prompt = context_prefix + req.message
    slug = req.context.slug if req.context else None

    all_tools = ["search_wiki", "search_all_content", "query_data", "web_search", "annotate_article"]
    enabled_tools = all_tools if req.web_search else [t for t in all_tools if t != "web_search"]
    tool_choice = {"type": "tool", "name": enabled_tools} if not req.web_search else None

    def generate():
        for event in agent_run_stream(prompt, tool_choice=tool_choice):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

        if slug:
            try:
                updated_article = wiki_service.get_wiki_article(slug)
                if updated_article:
                    yield f"event: article_updated\ndata: {json.dumps({'slug': slug, 'content': updated_article.get('content', ''), 'title': updated_article.get('title', '')})}\n\n"
            except Exception:
                pass

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream; charset=utf-8")
