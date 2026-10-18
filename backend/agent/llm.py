"""Gemini wrapper for natural phrasing, off-script answers and summaries.

Every call has a hard timeout and falls back to the template line, so a slow or failing
API never stalls a call that is happening in real time with a patient on the phone.
Mock mode uses the templates directly and never opens a socket.

Gemini is called over plain REST with httpx rather than through a client library. There is
one request shape in here and the whole file is a page long, so a dependency that has to
be installed before the backend starts would buy nothing and is one more thing that can be
missing on a laptop five minutes before a demo.
"""

from ..config import cfg
from . import safety

TIMEOUT_S = 6.0      # hard ceiling, a patient is waiting on the other end of the call
MAX_TOKENS = 512     # one or two spoken sentences, deliberately short

API = "https://generativelanguage.googleapis.com/v1beta/models"

# Statuses that mean "try again later", not "you asked for something wrong". These get the
# template with no error recorded, because an overloaded model is not a misconfiguration
# and surfacing it on the health screen would cry wolf. 429 and 503 are both routine on a
# free-tier key: a handful of calls a minute is enough to hit the quota.
TRANSIENT = (429, 500, 502, 503, 504)

SYSTEM = """You are the voice of Synapshot, a weekly check-in assistant for someone recovering
from a concussion. You are on a video call with them right now.

Rules you must never break:
- You are not a clinician. You never diagnose, never name a condition they might have, and
  never say or imply what is wrong with them.
- You never give return-to-play, return-to-work, or driving clearance, and never discuss
  medication or doses. If asked, say it is a question for their clinician and that you
  will pass it on.
- You never read scores or measurements back to the patient, and never say whether a
  result is good or bad. Their clinician does that.
- If they mention anything that sounds like an emergency, stop everything and tell them to
  get medical help now.

How you speak: one or two short sentences, warm and plain, no lists, no jargon, no emoji.
You are reading this aloud, so write it the way it should sound."""


def model_name() -> str:
    """The Gemini model id that will be called."""
    return cfg.gemini_model


def live() -> bool:
    """True when a real model call should be attempted."""
    return bool(not cfg.mock_llm and cfg.gemini_key)


def thinking(model: str) -> dict:
    """The thinkingConfig for a model, when it can be turned off.

    Phrasing a scripted line is not reasoning, and the latency budget is a few seconds of
    a live call, so thinking is off wherever that is allowed. Only the flash models accept
    a budget of zero; 2.5 Pro always thinks, so it is left alone rather than sent a value
    the API would reject.
    """
    return {"thinkingConfig": {"thinkingBudget": 0}} if "flash" in model else {}


def generate(prompt: str, system: str, max_tokens: int, temperature: float = 0.4,
             timeout: float = TIMEOUT_S) -> dict:
    """One Gemini completion over REST. Returns {'text', 'model'}, {'error'} or {}.

    An empty dict means a transient failure the caller should treat as "no answer" without
    complaining about it. {'error': ...} is something worth showing somebody.
    """
    import httpx

    model = cfg.gemini_model
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
            **thinking(model),
        },
    }
    try:
        resp = httpx.post(
            f"{API}/{model}:generateContent",
            json=body,
            headers={"x-goog-api-key": cfg.gemini_key},
            timeout=timeout,
        )
    except (httpx.TimeoutException, httpx.TransportError):
        return {"transient": 0}
    return reply(resp)


def reply(resp) -> dict:
    """Read one generateContent response.

    Returns {'text', 'model'} on success, {'error': why} for something worth showing
    somebody, and {'transient': status} for a failure that is nobody's fault and will
    probably work next time. Callers that only want an answer can test for 'text' and
    treat everything else the same; `probe` is the one that cares which it was.
    """
    if resp.status_code != 200:
        if resp.status_code in TRANSIENT:
            return {"transient": resp.status_code}
        return {"error": f"{resp.status_code} gemini"}
    try:
        data = resp.json()
    except Exception:
        return {"error": "gemini sent something that is not JSON"}
    cand = (data.get("candidates") or [{}])[0]
    # A refusal is a normal 200. Either the prompt was blocked before the model saw it, or
    # the candidate came back stopped on safety with no usable text in it.
    blocked = data.get("promptFeedback", {}).get("blockReason")
    if blocked or cand.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"):
        return {"error": "refusal"}
    # Thought parts come back in the same list as the answer and also carry `text`, so
    # they have to be dropped by the `thought` flag rather than by shape. Joining them in
    # would put the model's reasoning in front of a spoken line, and in front of the JSON
    # that extract.py is about to parse.
    parts = cand.get("content", {}).get("parts") or []
    text = " ".join(p.get("text", "") for p in parts
                    if "text" in p and not p.get("thought")).strip()
    if not text:
        # MAX_TOKENS spent entirely on thinking leaves a 200 with no text in it. Rare now
        # that thinking is off, but it is a transient shape, not a misconfiguration.
        return {"transient": 200}
    return {"text": text, "model": data.get("modelVersion") or cfg.gemini_model}


def ask(prompt: str, fallback: str, system: str = SYSTEM, max_tokens: int = MAX_TOKENS) -> dict:
    """One short completion, or the fallback template on any problem at all."""
    out = {"text": safety.clean(fallback), "how": "template", "model": None}
    if not live():
        return out
    try:
        got = generate(prompt, system, max_tokens)
    except Exception as exc:
        out["error"] = str(exc)[:200]
        return out
    if got.get("error"):
        out["error"] = got["error"]
    if not got.get("text"):
        return out
    return {"text": safety.clean(got["text"]), "how": "model", "model": got.get("model")}


def say_step(step: dict, name: str, week: int) -> str:
    """The line for one script step, phrased naturally when the model is available."""
    prompt = (
        f"You are on week {week} of check-ins with {name.split()[0]}. The next task is "
        f"'{step['id']}'. Here is the scripted line:\n\n{step['say']}\n\n"
        "Say the same thing in your own words, keeping every instruction in it exactly as "
        "precise. Do not add anything new."
    )
    return ask(prompt, step["say"])["text"]


def off_script(said: str, step: dict, name: str) -> str:
    """A reply to something the patient said that is not an answer to the task."""
    prompt = (
        f"{name.split()[0]} just said: \"{said}\"\n\n"
        f"You are in the middle of the '{step['id']}' task. Answer them in one or two "
        "sentences and bring them back to the task. If they asked for clinical advice, say "
        "it is for their clinician."
    )
    fallback = "Thanks for telling me. Let us finish this part and I will note it for your clinician."
    if wants_repeat(said):
        fallback = step["say"]
    return ask(prompt, fallback)["text"]


def wants_repeat(said: str) -> bool:
    """True when the patient asked for the instruction again."""
    low = str(said).lower()
    return any(p in low for p in ("repeat", "say that again", "what was that", "sorry, again", "pardon"))


def wants_pause(said: str) -> bool:
    """True when the patient asked to stop or take a break."""
    low = str(said).lower()
    return any(p in low for p in ("stop", "pause", "break", "hold on", "wait a", "one moment", "minute"))


def summarize(kind: str, facts: dict, fallback: str) -> str:
    """A short summary from a facts dict, used by summary.py."""
    import json

    prompt = (
        f"Write the {kind} summary from these facts:\n{json.dumps(facts, indent=2, default=str)}\n\n"
        "Follow every rule in your instructions. No numbers that would alarm anyone, no "
        "interpretation of what the measurements mean."
    )
    return ask(prompt, fallback, max_tokens=700)["text"]


PROBE_TIMEOUT_S = 15.0
PROBE_TRIES = 3          # a 5xx or a dropped connection is worth riding out once or twice
PROBE_GAP_S = 1.5


def probe() -> dict:
    """Actually call the configured model. {'ok', 'why', 'quota'}.

    This is the only honest answer to "is the LLM live". A key that is set and a model id
    that looks plausible both pass without proving anything, and the failure they hide is
    the quiet one: every call 404s, every line falls back to its template, and the screen
    says live. `make check` runs this so a wrong model id is something you read rather
    than something you notice later.

    A 429 is reported as its own thing rather than as a failure, because it is the one
    answer that proves the setup is right: the request was understood, accepted and then
    turned away for quota. Nothing is misconfigured and nothing needs changing, but lines
    will come out as templates until the quota resets, which is worth saying plainly.

    Retries are for 5xx and dropped connections only. Retrying a 429 would spend more of
    the quota that just ran out, and would not learn anything the first one did not say.

    Costs a tiny completion or two, so it belongs in a check command and nowhere near a
    hot path. On a real call a 429 is left alone on purpose: the template is the right
    answer when somebody is waiting, and spending the latency budget on a retry is not.
    """
    import time

    if not live():
        return {"ok": False, "why": "not live, so nothing was called"}
    for attempt in range(PROBE_TRIES):
        try:
            got = generate("Reply with the single word: ok", "You reply with one word.", 64,
                           temperature=0.0, timeout=PROBE_TIMEOUT_S)
        except Exception as exc:
            return {"ok": False, "why": str(exc)[:160]}
        if got.get("text"):
            return {"ok": True, "why": f"answered as {got.get('model') or model_name()}"}
        if got.get("error", "").startswith("404"):
            return {"ok": False, "why": f"{model_name()} is not a model this key can call"}
        if got.get("error"):
            return {"ok": False, "why": got["error"]}
        if got.get("transient") == 429:
            return {"ok": False, "quota": True,
                    "why": f"the key and {model_name()} are both fine, but the quota is "
                           "used up, so lines fall back to templates until it resets"}
        if attempt + 1 < PROBE_TRIES:
            time.sleep(PROBE_GAP_S)
    return {"ok": False, "why": "no answer after "
                                f"{PROBE_TRIES} tries, which is usually the API being busy"}


def status() -> dict:
    """What mode the LLM is in, for the preflight and the health endpoint.

    Deliberately does not call the API. This is read on a health endpoint, so it reports
    configuration only; `probe` is the one that costs a request.
    """
    return {
        "live": live(),
        "provider": "gemini",
        "model": model_name(),
        "timeout_s": TIMEOUT_S,
    }
