"""The care pipeline, run on three CREAO agents (agent.creao.ai) through its API Trigger.

    triage  ->  briefing  +  outreach

The triage agent reads a de-identified summary of the week and rates it routine, watch or
escalate. That rating decides what happens next: escalate raises an alert in the app, and a
routine week skips the outreach agent. The briefing agent writes the clinician's briefing and
the outreach agent drafts the follow-up. This backend is the orchestrator: it hands each
agent's output to the next one, and the app acts on what the agents decided.

Runs take minutes, so nothing waits on one. `start` returns at once, the UI polls `latest`,
and every poll (or a webhook) calls `advance`, which asks CREAO how each stage is doing and
starts the next stage when its turn comes.

Rules this module holds to:
- The CREAO key is read from the server environment and never leaves it.
- Nothing is sent that names the patient. The agents get a pseudonymous reference.
- A pipeline starts only when a person presses the button, or when AUTO_AGENT_PIPELINE is set.
  The demo and the alert rules never start one by themselves, because every run spends credits.
- The agents can raise attention but never lower it. An "escalate" adds an alert, and a
  "routine" removes nothing. The rule based alerts stay authoritative.
- An agent never places a call or sends a message. Its text is a draft, it goes through
  `safety.clean`, and a clinician decides what to do with it.
- A role with no agent id, or no key, runs as a template (mock), labelled as such, so the whole
  flow can be shown and tested without credentials.
"""

import hashlib
import hmac
import json
import time

from .. import alerts as alertmod
from .. import db
from ..config import cfg
from . import safety, summary

TIMEOUT_S = 15.0           # for the start and status calls, never for the run itself
MOCK_DELAY_S = 4.0         # how long a mock stage pretends to take
DEDUPE_S = 45.0            # a second press inside this window returns the pipeline already going
DONE = {"completed"}
FAILED = {"failed", "cancelled"}
ENDED = DONE | FAILED | {"skipped"}
LEVELS = ("routine", "watch", "escalate")
ROLES = {"triage": "Triage", "briefing": "Briefing", "outreach": "Outreach"}

# The key each role's JSON reply must contain. Used to find the answer inside a chatty reply.
KEYS = {"triage": "level", "briefing": "briefing", "outreach": "patient_message"}

BRIEF = (
    "You are one agent in a concussion recovery care pipeline. Use only the facts in the inputs. "
    "Do not diagnose, do not clear anyone to return to play, work or driving, and do not discuss "
    "medication. Reply with JSON only."
)


def agent_for(role: str) -> str:
    """The CREAO agent id for a role. A role with no id of its own does not borrow another's."""
    if role == "briefing":
        return cfg.creao_agent
    return {"triage": cfg.creao_triage_agent, "outreach": cfg.creao_outreach_agent}.get(role, "")


def live(role: str = "briefing") -> bool:
    """True when this role should run on a real CREAO agent."""
    return bool(not cfg.mock_creao and cfg.creao_key and agent_for(role))


def token() -> str:
    """The secret in the webhook URL. Derived from the key, so it is stable and not guessable."""
    seed = (cfg.creao_key or "mock").encode()
    return hmac.new(seed, b"synapshot-creao-webhook", hashlib.sha256).hexdigest()[:24]


def callback_url() -> str | None:
    """The public https URL CREAO can post to, or None when there is no tunnel."""
    if cfg.public_url.startswith("https://"):
        return f"{cfg.public_url}/api/creao/callback?token={token()}"
    return None


def pseudonym(pid: str) -> str:
    """A stable reference that does not carry the patient's name or id."""
    return "pt-" + hashlib.sha256(pid.encode()).hexdigest()[:8]


# ---------------------------------------------------------------- what the agents are given

def facts(pid: str, week: int) -> dict:
    """The de-identified inputs for one week. No name, no phone, no free text."""
    row = db.patient(pid)
    chk = db.one("select * from checkins where patient_id=? and week=? order by date desc, rowid desc limit 1",
                 (pid, week))
    got = None
    if chk is not None:
        got = {"channel": db.dec(chk["channel"], {}) or {}, "features": db.dec(chk["features"], []) or []}
    changed = []
    for f in (got or {}).get("features", []):
        if f.get("changed"):
            changed.append({"name": str(f.get("name", "")).replace("_", " "), "value": f.get("value"),
                            "previous": f.get("prev"), "unit": f.get("unit", "")})
    chan = (got or {}).get("channel", {})
    # The agents' own alerts are left out, or one pipeline's escalation would feed the next one's triage.
    alerts = [{"type": a["type"], "trigger": a["trigger"], "acknowledged": bool(a["acked"])}
              for a in db.alerts(pid) if a["type"] != "agent_review"][:5]
    age = int(row["age"]) if row and row["age"] is not None else None
    return {
        "patient_ref": pseudonym(pid),
        "week": int(week),
        "age_band": f"{(age // 10) * 10}s" if age is not None else "unknown",
        "drift_z": round(float(row["drift_z"] or 0.0), 2) if row else 0.0,
        "check_in_completed": got is not None,
        "measures_beyond_minimal_change": changed[:6],
        "video_quality": {
            "frames_per_second": round(float(chan.get("fps", 0) or 0)),
            "face_visible_share": round(float(chan.get("face_share", 0) or 0), 2),
        },
        "alerts": alerts,
        "red_flags": [f for f in alertmod.flags(pid) if f != "agent_review"],
    }


def stage_inputs(role: str, base: dict, triage: dict | None) -> dict:
    """What one role is sent. Later roles also get what triage decided."""
    out = {"role": role, **base, "note": BRIEF}
    if triage and role != "triage":
        out["triage"] = {"level": triage.get("level"), "reasons": triage.get("reasons", [])}
    return out


# ---------------------------------------------------------------- template (mock) outputs

def mock_output(role: str, pid: str, week: int, inputs: dict) -> dict:
    """What a template stage returns, built from the same facts the agent would have had."""
    row = db.patient(pid)
    name = str(row["name"]) if row else "the patient"
    if role == "triage":
        flags = inputs.get("red_flags") or []
        z = float(inputs.get("drift_z") or 0)
        moved = inputs.get("measures_beyond_minimal_change") or []
        reasons = []
        if flags:
            reasons.append("Alert types on record: " + ", ".join(str(f).replace("_", " ") for f in flags) + ".")
        if z >= 2:
            reasons.append(f"Drift z is {z:.1f}, outside the forecast band toward worse.")
        if moved:
            reasons.append(f"{len(moved)} measure(s) moved beyond the minimal detectable change.")
        level = "escalate" if ("red_flag" in flags or z >= 2) else "watch" if (z >= 1 or moved) else "routine"
        return {"level": level, "reasons": reasons or ["Nothing moved beyond its expected range."]}
    if role == "briefing":
        chk = db.one("select * from checkins where patient_id=? and week=? order by date desc, rowid desc limit 1",
                     (pid, week))
        got = None
        if chk is not None:
            got = {"channel": db.dec(chk["channel"], {}) or {}, "features": db.dec(chk["features"], []) or [],
                   "quality": {"ok": True}}
        return {"briefing": "Template briefing, no CREAO agent was called. " + summary.clinician_text(name, week, got),
                "follow_ups": ["Ask how the headaches have been this week."]}
    first = name.split()[0]
    return {"patient_message": f"Thanks {first}, that is week {week} done. Your clinician will be in touch about "
                               "anything they want to follow up. " + summary.SAFETY_CLOSE,
            "next_steps": ["Review the briefing before the next call."]}


# ---------------------------------------------------------------- the CREAO calls

def _headers() -> dict:
    return {"Authorization": f"Bearer {cfg.creao_key}", "Content-Type": "application/json"}


def _post_run(agent: str, inputs: dict, key: str) -> dict:
    """POST /api/v1/runs. Returns the parsed 202 body, or raises."""
    import httpx

    body = {"appId": agent, "inputs": {"briefing_request": json.dumps(inputs)}, "idempotencyKey": key}
    url = f"{cfg.creao_url}/api/v1/runs"
    hook = callback_url()
    if hook:
        resp = httpx.post(url, json={**body, "webhookUrl": hook}, headers=_headers(), timeout=TIMEOUT_S)
        # CREAO validates the webhook URL and refuses a tunnel it cannot use. Polling does the same
        # job, so a refused webhook must not stop the run: retry without it.
        if resp.status_code != 400:
            resp.raise_for_status()
            return resp.json()
    resp = httpx.post(url, json=body, headers=_headers(), timeout=TIMEOUT_S)
    resp.raise_for_status()
    return resp.json()


def _get_run(creao_run_id: str) -> dict:
    """GET /api/v1/runs/{id}. The only source of truth for a run's state."""
    import httpx

    resp = httpx.get(f"{cfg.creao_url}/api/v1/runs/{creao_run_id}", headers=_headers(), timeout=TIMEOUT_S)
    resp.raise_for_status()
    return resp.json()


def _text_of(body: dict) -> str:
    """The agent's text out of a run body, whichever of the documented shapes it came in."""
    res = body.get("result") or {}
    if isinstance(res, str):
        return res
    return str(res.get("text") or res.get("chatText") or "").strip()


def _json_in(text: str, key: str) -> dict | None:
    """The first JSON object in a string that carries `key`, fences and chatter allowed."""
    dec = json.JSONDecoder()
    for i, ch in enumerate(text or ""):
        if ch != "{":
            continue
        try:
            got, _ = dec.raw_decode(text[i:])
        except ValueError:
            continue
        if isinstance(got, dict) and got.get(key):
            return got
    return None


def _from_artifacts(body: dict, key: str) -> dict | None:
    """Some runs save the answer as a .json file and chat about it. Read that file instead."""
    import httpx

    for art in (body.get("result") or {}).get("artifacts") or []:
        if not str(art.get("title", "")).lower().endswith(".json") or not art.get("url"):
            continue
        try:
            resp = httpx.get(art["url"], timeout=TIMEOUT_S)
            resp.raise_for_status()
            got = resp.json()
        except Exception:
            continue
        if isinstance(got, dict):
            if got.get(key):
                return got
            nested = _json_in(json.dumps(got), key)
            if nested:
                return nested
    return None


def _markdown_artifact(body: dict) -> str | None:
    """Some runs save the briefing as a Markdown file. Use its text when there is no JSON."""
    import httpx

    for art in (body.get("result") or {}).get("artifacts") or []:
        if not str(art.get("title", "")).lower().endswith((".md", ".markdown")) or not art.get("url"):
            continue
        try:
            resp = httpx.get(art["url"], timeout=TIMEOUT_S)
            resp.raise_for_status()
        except Exception:
            continue
        if resp.text.strip():
            return resp.text.strip()
    return None


WRONG_FORMAT = ("The agent replied in a format the app cannot read. Update its instructions from "
                "docs/CREAO.md so it replies with the JSON only.")


# ---------------------------------------------------------------- stages

def _epoch(stamp: str) -> float:
    """db.now() text back to seconds, or 0 so an unreadable stamp never blocks a run."""
    try:
        return time.mktime(time.strptime(str(stamp)[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, TypeError):
        return 0.0


def _why(exc: Exception) -> str:
    """A short reason that cannot carry the key."""
    text = str(exc)
    if cfg.creao_key:
        text = text.replace(cfg.creao_key, "[key]")
    return text[:200]


def _stage(pipeline: str, pid: str, week: int, role: str, inputs: dict, skip: bool = False) -> str:
    """Create one stage row and, if it is live, start its CREAO run. Never waits for the agent."""
    rid = db.new_id("run")
    use_live = live(role) and not skip
    row = {"id": rid, "patient_id": pid, "week": int(week), "kind": role,
           "status": "skipped" if skip else "pending", "creao_run_id": None, "thread_id": None,
           "mock": 0 if use_live else 1, "inputs": db.enc(inputs), "result": db.enc({}), "error": None,
           "created": db.now(), "updated": db.now(), "pipeline": pipeline}
    if use_live:
        try:
            got = _post_run(agent_for(role), inputs, rid)
            row["creao_run_id"] = got.get("id")
            row["status"] = str(got.get("status") or "pending")
        except Exception as exc:
            row["status"] = "failed"
            row["error"] = _why(exc)
    db.put("agent_runs", row)
    db.event(pid, "creao_run_started", {"run": rid, "role": role, "pipeline": pipeline, "mock": not use_live})
    return rid


def _refresh(row) -> None:
    """Ask CREAO (or the mock clock) how one stage is doing and store the answer."""
    if row["status"] in ENDED:
        return
    rid, role = row["id"], row["kind"]
    if row["mock"]:
        if time.time() - _epoch(row["created"]) >= MOCK_DELAY_S:
            inputs = db.dec(row["inputs"], {}) or {}
            db.patch("agent_runs", rid, {"status": "completed", "updated": db.now(), "result": db.enc(
                mock_output(role, row["patient_id"], int(row["week"] or 0), inputs))})
        return
    if not row["creao_run_id"]:
        return
    try:
        body = _get_run(row["creao_run_id"])
    except Exception as exc:
        db.patch("agent_runs", rid, {"error": _why(exc), "updated": db.now()})
        return
    status = str(body.get("status") or row["status"])
    fields = {"status": status, "updated": db.now(), "error": None, "thread_id": body.get("threadId")}
    if status in DONE:
        key = KEYS[role]
        text = _text_of(body)
        got = _json_in(text, key) or _from_artifacts(body, key)
        if got is None and role == "briefing":
            md = _markdown_artifact(body)
            if md:
                got = {"briefing": md}
        if got is None:
            if role == "triage":
                got = {"level": "watch", "reasons": ["The triage agent did not return a rating, so this was held at watch."]}
            elif text.lstrip().startswith(("{", "[", "```")):
                got = {}
                fields["error"] = WRONG_FORMAT
            else:
                got = {key: text}
        fields["result"] = db.enc(got)
    elif status in FAILED:
        fields["error"] = f"The CREAO run {status}."
    db.patch("agent_runs", rid, fields)


def _readable(out: dict, key: str) -> dict:
    """Never show raw JSON as prose. Unwrap it if it holds the answer, drop it if it does not."""
    text = str(out.get(key) or "")
    if not text.lstrip().startswith(("{", "[", "```")):
        return out
    inner = _json_in(text, key)
    return inner if inner else {k: v for k, v in out.items() if k != key}


def _rows(pipeline: str) -> dict:
    """The stage rows of one pipeline, by role."""
    return {r["kind"]: r for r in db.rows("select * from agent_runs where pipeline=? order by created, rowid", (pipeline,))}


def _out(row) -> dict:
    return (db.dec(row["result"], {}) or {}) if row is not None else {}


def _act(pid: str, week: int, pipeline: str, triage: dict) -> bool:
    """The app acts on what triage decided. Escalate raises an alert, nothing ever lowers one.

    No call is placed and nothing is sent: the alert only appears on the clinician's list.
    Returns True when an alert was raised.
    """
    level = triage.get("level")
    db.event(pid, "agent_triage", {"pipeline": pipeline, "level": level, "reasons": triage.get("reasons", [])})
    if level != "escalate" or alertmod.recent(pid, "agent_review", within=1):
        return False
    why = " ".join(str(r) for r in (triage.get("reasons") or [])[:2]) or "No reason given."
    alertmod.create(pid, "agent_review", f"Week {week}. The triage agent escalated this week for review. {why}", notify=False)
    return True


def advance(pipeline: str) -> None:
    """Move a pipeline forward: refresh every stage, and when triage lands, act and start the rest."""
    for r in _rows(pipeline).values():
        _refresh(r)
    rows = _rows(pipeline)
    tri = rows.get("triage")
    if tri is None or tri["status"] not in DONE or "briefing" in rows:
        return
    pid, week = tri["patient_id"], int(tri["week"] or 0)
    out = _out(tri)
    if out.get("level") not in LEVELS:
        out["level"] = "watch"
    _act(pid, week, pipeline, out)
    base = db.dec(tri["inputs"], {}) or {}
    base.pop("role", None)
    base.pop("note", None)
    _stage(pipeline, pid, week, "briefing", stage_inputs("briefing", base, out))
    _stage(pipeline, pid, week, "outreach", stage_inputs("outreach", base, out), skip=out["level"] == "routine")


# ---------------------------------------------------------------- the pipeline

def _view(pipeline: str) -> dict | None:
    """One pipeline as the API returns it. Every text has been through the safety filter."""
    rows = _rows(pipeline)
    tri = rows.get("triage")
    if tri is None:
        return None
    tri_out = _out(tri)
    stages = []
    for role, label in ROLES.items():
        r = rows.get(role)
        stages.append({
            "role": role, "label": label,
            "status": r["status"] if r is not None else "pending",
            "mock": bool(r["mock"]) if r is not None else not live(role),
            "agent_id": None if (r is None or r["mock"]) else agent_for(role),
            "creao_run_id": r["creao_run_id"] if r is not None else None,
            "error": r["error"] if r is not None else None,
        })
    brief, outreach = _out(rows.get("briefing")), _out(rows.get("outreach"))
    if tri["status"] in FAILED:
        status = "failed"
    elif len(rows) == 3 and all(r["status"] in ENDED for r in rows.values()):
        status = "completed"
    else:
        status = "running"
    level = tri_out.get("level") if tri["status"] in DONE else None
    raised = db.one("select 1 from events where patient_id=? and kind='alert' and payload like ? and time>=? limit 1",
                    (tri["patient_id"], '%agent_review%', tri["created"]))
    clean = lambda items: [safety.clean(str(x)) for x in (items or [])][:5]  # noqa: E731
    brief = _readable(brief, "briefing")
    draft = outreach.get("patient_message") or brief.get("patient_draft")
    return {
        "id": pipeline, "week": int(tri["week"] or 0), "status": status, "level": level,
        "reasons": clean(tri_out.get("reasons")) if level else [],
        "escalated": bool(raised) and level == "escalate",
        "stages": stages,
        "briefing": safety.clean(str(brief["briefing"])) if brief.get("briefing") else None,
        "follow_ups": clean(brief.get("follow_ups")),
        "patient_message": safety.clean(str(draft)) if draft else None,
        "next_steps": clean(outreach.get("next_steps")),
        "created": tri["created"], "updated": max(r["updated"] for r in rows.values()),
    }


def start(pid: str, week: int) -> dict:
    """Start the pipeline by running the triage agent. Returns at once, never waits for it."""
    recent = db.one(
        "select pipeline from agent_runs where patient_id=? and week=? and kind='triage' "
        "order by created desc, rowid desc limit 1", (pid, week))
    if recent is not None and recent["pipeline"]:
        view = _view(recent["pipeline"])
        if view and view["status"] == "running" and time.time() - _epoch(view["created"]) < DEDUPE_S:
            return view
    pipeline = db.new_id("pipe")
    _stage(pipeline, pid, week, "triage", stage_inputs("triage", facts(pid, week), None))
    return _view(pipeline)  # type: ignore[return-value]


def latest(pid: str) -> dict | None:
    """The newest pipeline for a patient, advanced first if it is still going."""
    row = db.one("select pipeline from agent_runs where patient_id=? and kind='triage' "
                 "order by created desc, rowid desc limit 1", (pid,))
    if row is None or not row["pipeline"]:
        return None
    advance(row["pipeline"])
    return _view(row["pipeline"])


def on_callback(payload: dict) -> bool:
    """A webhook arrived. Use only its run id, then ask CREAO for the real state."""
    cid = str((payload or {}).get("runId") or "")
    row = db.one("select pipeline from agent_runs where creao_run_id=?", (cid,)) if cid else None
    if row is None or not row["pipeline"]:
        return False
    advance(row["pipeline"])
    return True


def status() -> dict:
    """For the health view and the preflight. Never carries the key."""
    return {
        "agents": {role: {"live": live(role), "agent_id": agent_for(role) or None} for role in ROLES},
        "webhook": callback_url() is not None,
        "auto": cfg.auto_agents,
    }
