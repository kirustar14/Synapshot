"""Anthropic SDK wrapper for natural phrasing, off-script answers and summaries.

Every call has a hard timeout and falls back to the template line, so a slow or failing
API never stalls a call that is happening in real time with a patient on the phone.
Mock mode uses the templates directly and never opens a socket.
"""

from ..config import cfg
from . import safety

TIMEOUT_S = 6.0      # hard ceiling, a patient is waiting on the other end of the call
MAX_TOKENS = 512     # one or two spoken sentences, deliberately short
RETRIES = 0          # a retry would double the wait, the template is the better fallback

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


def live() -> bool:
    """True when a real model call should be attempted."""
    return bool(not cfg.mock_llm and cfg.anthropic_key)


def client():
    """Anthropic client with the hard timeout applied, or None."""
    if not live():
        return None
    try:
        import anthropic

        return anthropic.Anthropic(api_key=cfg.anthropic_key, timeout=TIMEOUT_S, max_retries=RETRIES)
    except Exception:
        return None


def ask(prompt: str, fallback: str, system: str = SYSTEM, max_tokens: int = MAX_TOKENS) -> dict:
    """One short completion, or the fallback template on any problem at all.

    Thinking is off and effort is low: this is phrasing, not reasoning, and the latency
    budget is a few seconds of a live phone call.
    """
    out = {"text": safety.clean(fallback), "how": "template", "model": None}
    cli = client()
    if cli is None:
        return out

    import anthropic

    try:
        resp = cli.messages.create(
            model=cfg.claude_model,
            max_tokens=max_tokens,
            system=system,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.APITimeoutError, anthropic.RateLimitError, anthropic.APIConnectionError):
        return out
    except anthropic.APIStatusError as exc:
        out["error"] = f"{exc.status_code} {exc.type}"
        return out
    except Exception as exc:
        out["error"] = str(exc)[:200]
        return out

    # A refusal comes back as a normal 200 with an empty or partial content list.
    if resp.stop_reason == "refusal":
        out["error"] = "refusal"
        return out
    text = " ".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    if not text:
        return out
    return {"text": safety.clean(text), "how": "model", "model": resp.model}


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


def status() -> dict:
    """What mode the LLM is in, for the preflight and the health endpoint."""
    try:
        import anthropic  # noqa: F401

        installed = True
    except Exception:
        installed = False
    return {
        "live": live(),
        "sdk_installed": installed,
        "model": cfg.claude_model,
        "timeout_s": TIMEOUT_S,
    }
