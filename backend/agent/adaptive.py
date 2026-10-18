"""The decision model and the adaptive test controller.

The model answers typed questions about the evidence collected so far:

    {"p": {"drift": [worse, stable, better],
           "worst_domain": [ocular, speech, memory, symptom, none]},
     "next": "ocular"}

`next` is the next assessment block. The controller picks the block with the most expected
information per second of patient burden. Safety and gate blocks are never candidates:
red flags, consent, quality and calibration always run.

Three sources, in order: a Veri deployment when it is configured and answers within three
seconds, otherwise the deterministic heuristic, otherwise the static script. The response
always names which one answered, so an unchanged demo cannot be mistaken for the model.
"""

import json
import math
import time

import httpx

from .. import db
from ..config import cfg
from ..features import sem as semmod
from ..twin import forecast as fcast

BLOCKS = {
    "ocular": {
        "minutes": 2.8,
        "signals": ["pursuit_gain", "saccade_latency", "antisaccade_err", "bcea"],
        "steps": ["pursuit_h", "pursuit_v", "saccade", "antisaccade", "fixation", "npc"],
    },
    "speech": {
        "minutes": 2.4,
        "signals": ["speech_rate"],
        "steps": ["speech_ah", "speech_pataka", "speech_passage", "picture"],
    },
    "memory": {
        "minutes": 2.75,
        "signals": ["recall_delayed"],
        "steps": ["encode", "recall", "fluency"],
    },
    "symptoms": {
        "minutes": 1.4,
        "signals": ["symptom_total"],
        "steps": ["symptoms", "symptoms_rerate"],
    },
}

ORDER = ["symptoms", "memory", "ocular", "speech"]
DOMAINS = ["ocular", "speech", "memory", "symptom", "none"]
DRIFT = ["worse", "stable", "better"]

SYSTEM = (
    "You are a decision model for a research check-in after traumatic brain injury. "
    "You are given the evidence collected so far and the assessment blocks not yet run. "
    "Answer with JSON only, no prose. The object has two keys. 'p' holds two probability "
    "vectors: 'drift' is [worse, stable, better] and 'worst_domain' is "
    "[ocular, speech, memory, symptom, none]. Every vector has five or three numbers that "
    "are non-negative and sum to 1. 'next' is one of ocular, speech, memory, symptoms, or "
    "stop. Choose the block with the most expected information per minute of patient "
    "burden. Never choose a safety or calibration step. Do not diagnose."
)


def _last_week(pid: str) -> tuple[dict, dict]:
    """The latest observations and the forecast band, when they exist."""
    obs = db.observations(pid)
    latest = obs[-1]["values"] if obs else {}
    row = db.latest_forecast(pid)
    band: dict = {}
    if row is not None:
        payload = db.dec(row["payload"], {}) or {}
        for sig in payload.get("signals", []):
            mean = sig.get("mean") or []
            if mean:
                band[sig.get("key")] = float(mean[-1])
    return latest, band


def state_of(pid: str, session: dict | None = None, done: list[str] | None = None) -> dict:
    """The compact evidence object the model and the heuristic both read."""
    pat = db.patient(pid)
    latest, band = _last_week(pid)
    session = session or {}
    symptoms = db.dec(session.get("symptoms"), {}) or {}
    scores = symptoms.get("symptoms", {}) if isinstance(symptoms, dict) else {}
    channel = db.dec(session.get("channel"), {}) or {}
    residuals = {}
    for key, value in latest.items():
        if key in band and band[key]:
            residuals[key] = round((float(value) - band[key]) / max(semmod.sem(key), 1e-6), 2)
    return {
        "patient_id": pid,
        "week": int(pat["week"] or 0) if pat else int(session.get("week") or 0),
        "drift_z": round(float(pat["drift_z"] or 0.0), 2) if pat else 0.0,
        "symptom_total": round(float(sum(scores.values())), 1) if scores else 0.0,
        "symptom_jump": round(float(symptoms.get("jump") or 0.0), 1) if isinstance(symptoms, dict) else 0.0,
        "quality_ok": bool(channel.get("flash_ok", True)) if channel else True,
        "residuals": residuals,
        "done": list(done or []),
        "remaining": [b for b in ORDER if b not in (done or [])],
    }


def _score(block: str, state: dict) -> float:
    """Expected information per minute. Deliberately small and auditable.

    Each signal contributes its precision (1 / SEM squared), scaled by how far the last
    observation sat from the forecast band. A block whose signals have moved is worth more
    than a block whose signals are exactly where the twin expected them.
    """
    spec = BLOCKS[block]
    info = 0.0
    for key in spec["signals"]:
        precision = 1.0 / max(float(semmod.sem(key)), 1e-6) ** 2
        z = abs(float(state.get("residuals", {}).get(key, 0.0)))
        info += precision * (1.0 + min(z, 4.0) * 0.5)
    if block == "symptoms" and float(state.get("symptom_jump") or 0.0) >= 10.0:
        info *= 1.4  # a jump is itself informative
    if block == "ocular" and not bool(state.get("quality_ok", True)):
        info *= 0.3  # a bad camera makes the ocular block cheap to skip
    return info / max(float(spec["minutes"]), 0.1)


def heuristic(state: dict) -> dict:
    """Pick the best remaining block, or stop when nothing is worth the burden."""
    remaining = [b for b in ORDER if b in state.get("remaining", [])]
    scores = {b: round(_score(b, state), 3) for b in remaining}
    if not scores:
        return {"next": "stop", "scores": scores, "reason": "every block has run"}
    best = max(scores, key=scores.get)
    # Two or more minutes of patient time has to buy something. Under this ratio the
    # call ends early, which is the whole point of an adaptive test.
    if scores[best] < 0.05:
        return {"next": "stop", "scores": scores,
                "reason": "no remaining block clears the information threshold"}
    return {"next": best, "scores": scores,
            "reason": f"highest expected information per minute ({scores[best]:.3f})"}


def _valid(got) -> dict | None:
    """Accept only the exact contract. Anything else is a fallback, not a guess."""
    if not isinstance(got, dict):
        return None
    probs = got.get("p")
    nxt = str(got.get("next") or "")
    if not isinstance(probs, dict) or nxt not in (set(ORDER) | {"stop"}):
        return None
    out = {}
    for name, want in (("drift", len(DRIFT)), ("worst_domain", len(DOMAINS))):
        vec = probs.get(name)
        if not isinstance(vec, list) or len(vec) != want:
            return None
        try:
            vals = [max(0.0, float(v)) for v in vec]
        except (TypeError, ValueError):
            return None
        total = sum(vals)
        if total <= 0:
            return None
        out[name] = [round(v / total, 4) for v in vals]
    return {"p": out, "next": nxt}


def ask_veri(state: dict) -> dict | None:
    """One three second attempt at the deployment. A miss is not an error."""
    if not cfg.veri_live():
        return None
    url = f"{cfg.veri_api_url}/v1/deployments/{cfg.veri_deployment_id}/chat/completions"
    body = {
        "model": cfg.veri_model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(state, sort_keys=True)},
        ],
        "temperature": 0.0,
        "max_tokens": 128,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=3.0) as client:
            res = client.post(url, json=body,
                              headers={"Authorization": f"Bearer {cfg.veri_api_key}"})
            res.raise_for_status()
            raw = res.json()["choices"][0]["message"]["content"]
        return _valid(json.loads(raw))
    except Exception:  # noqa: BLE001 - the fallback is the designed behaviour
        return None


def decide(pid: str, session: dict | None = None, done: list[str] | None = None) -> dict:
    """The one entry point the API uses."""
    state = state_of(pid, session=session, done=done)
    started = time.perf_counter()
    model = ask_veri(state)
    if model is not None:
        remaining = state["remaining"]
        nxt = model["next"]
        if nxt != "stop" and nxt not in remaining:
            nxt = "stop" if not remaining else remaining[0]
        return {
            "next": nxt,
            "probabilities": model["p"],
            "source": "veri",
            "reason": "the deployed decision model chose this block",
            "scores": {},
            "state": state,
            "ms": round((time.perf_counter() - started) * 1000.0, 1),
        }

    got = heuristic(state)
    fallback = "heuristic" if cfg.adaptive_mode != "veri" else "script"
    if fallback == "script":
        # The model was asked for and did not answer. Do not silently pass the heuristic
        # off as the model: name the fallback and let the caller show it.
        got = {"next": state["remaining"][0] if state["remaining"] else "stop",
               "scores": got.get("scores", {}),
               "reason": "the model did not answer, the static script order is running"}
    return {
        "next": got["next"],
        "probabilities": {},
        "source": fallback,
        "reason": got["reason"],
        "scores": got.get("scores", {}),
        "state": state,
        "ms": round((time.perf_counter() - started) * 1000.0, 1),
    }


def free_minutes(state: dict) -> float:
    """How much patient time the chosen policy saves against the full script."""
    done = set(state.get("done") or [])
    skipped = [b for b in ORDER if b not in done and b != state.get("next")]
    saved = sum(BLOCKS[b]["minutes"] for b in skipped)
    return round(max(0.0, saved), 2)


def probability_entropy(vec: list[float]) -> float:
    """Bits of uncertainty in one answer. Used by the evaluation, not the decision."""
    return -sum(p * math.log2(p) for p in vec if p > 0)
