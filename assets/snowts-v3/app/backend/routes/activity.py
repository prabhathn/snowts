import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..services import activity

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("/stream")
async def activity_stream():
    q = activity.subscribe()

    async def generate():
        try:
            for batch in activity.get_batches():
                yield f"event: batch\ndata: {json.dumps(batch)}\n\n"
            for event in activity.get_history(50):
                yield f"event: event\ndata: {json.dumps(event)}\n\n"
            yield f"event: sync\ndata: {json.dumps({'ok': True})}\n\n"

            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    if msg.get("__type") == "batch":
                        payload = {k: v for k, v in msg.items() if k != "__type"}
                        yield f"event: batch\ndata: {json.dumps(payload)}\n\n"
                    else:
                        yield f"event: event\ndata: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield f"event: ping\ndata: {json.dumps({'ts': ''})}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            activity.unsubscribe(q)

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/history")
async def activity_history():
    return {
        "events": activity.get_history(100),
        "batches": activity.get_batches(),
    }


@router.get("/batches")
async def activity_batches():
    return {"batches": activity.get_batches()}
