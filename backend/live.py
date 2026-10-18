"""Server-sent events, so the workspace and the call modal update without a reload.

This replaces the rig websocket hub. A call page posts to /api/call/{token}/live about
every 200 ms while a task runs, and the clinician's open workspace is watching the same
patient's stream, so the gaze dot and the step name arrive as they happen. When the
pipeline finishes it pushes one `call_done` event and the workspace refreshes itself.

Events are per patient. A browser subscribes to one patient and gets nothing about
anybody else, which matters because a clinician may have one patient open on a screen
somebody else can see.
"""

import asyncio
import json
import time
from collections import deque

# One queue per open browser connection, grouped by patient.
STREAMS: dict[str, list[asyncio.Queue]] = {}
# A short history per patient so a browser that connects mid-call catches up.
RECENT: dict[str, deque] = {}
KEEP = 40
HEARTBEAT_S = 15.0


def subscribe(pid: str) -> asyncio.Queue:
    """A new queue fed with every event for one patient."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    STREAMS.setdefault(pid, []).append(queue)
    for event in list(RECENT.get(pid, ())):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            break
    return queue


def unsubscribe(pid: str, queue: asyncio.Queue) -> None:
    """Drop a closed connection's queue."""
    got = STREAMS.get(pid) or []
    if queue in got:
        got.remove(queue)
    if not got:
        STREAMS.pop(pid, None)


def publish(pid: str, kind: str, data: dict | None = None) -> None:
    """Push one event to every browser watching this patient.

    Safe to call from a worker thread: a full queue drops the event rather than blocking,
    because a stalled browser must never hold up a call that is happening right now.
    """
    event = {"kind": kind, "t": round(time.time(), 3), **(data or {})}
    RECENT.setdefault(pid, deque(maxlen=KEEP)).append(event)
    for queue in list(STREAMS.get(pid) or []):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            continue


def frame(pid: str, step: str, gaze: dict, target: dict, quality: dict,
          gain: float | None = None, line: dict | None = None) -> None:
    """One live measurement tick, for the strip in the call modal."""
    publish(pid, "frame", {"step": step, "gaze": gaze, "target": target,
                           "quality": quality, "pursuit_gain": gain, "line": line})


def sse(event: dict) -> str:
    """One event in the server-sent events wire format."""
    return f"event: {event.get('kind', 'message')}\ndata: {json.dumps(event)}\n\n"


async def stream(pid: str):
    """An async generator of SSE text for one patient, with a keepalive."""
    queue = subscribe(pid)
    try:
        yield sse({"kind": "hello", "patient_id": pid})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
            except asyncio.TimeoutError:
                # A comment line keeps proxies and tunnels from closing an idle stream.
                yield ": keepalive\n\n"
                continue
            yield sse(event)
    finally:
        unsubscribe(pid, queue)
