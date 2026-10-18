"""Create the ElevenLabs conversational agent that reads the clinician update.

Run with `make agent`. Idempotent by name: it will not make a second one.

This agent talks to a clinician, not to a patient, which is why it is allowed to say
numbers at all. It still never diagnoses and never recommends treatment: its whole job is
to read a structured update that the backend already composed and filtered, repeat it
once, and hang up. The update arrives as the first message, so the agent is not inventing
any of it.

The config shape here was read off this account's own existing agent rather than guessed.
"""

import json
import urllib.error
import urllib.request

from ..config import cfg

API = "https://api.elevenlabs.io/v1/convai/agents"
NAME = "UNNAMED clinician update"  # lookup key for the existing agent, left as is
# Sarah, the calm premade voice that make voices settled on for the same reason.
VOICE = "EXAVITQu4vr4xnSDxMaL"

PROMPT = """You are the Synapshot alert line. You place a short outbound call to a
clinician to read them one update about one patient, and then you end the call.

The update has already been written for you and is given to you as your first message.
Your job is to deliver it, not to add to it.

What you do:
- Read the update exactly as given. Do not summarise it, reorder it, or add detail.
- If they ask you to repeat it, read it again in full, a little more slowly.
- If they ask who this is, say you are the Synapshot research check-in line calling about a
  patient's weekly measurements, and that the detail is on their dashboard.
- When they have acknowledged it, thank them and end the call.

What you never do:
- You never diagnose, and you never say what you think is wrong with the patient.
- You never recommend a treatment, a medication, a dose, or a change to any of them.
- You never give return to play, return to work, or driving clearance, and you never
  comment on whether any of those would be reasonable.
- You never answer a clinical question. Say the measurements are on the dashboard and the
  decision is theirs.
- You never speculate beyond the update. If something is not in it, say you do not have
  that and it will be on the dashboard.
- You never discuss any other patient.

Every patient in this system is synthetic and the data is research data, not care. If
asked, say so plainly.

How you speak: calm, brief, and clear, like someone reading a handover note. Short
sentences. No small talk, no filler, no emoji. This is a phone call and someone is
writing it down."""

FIRST = "{{clinician_update}}"


def body() -> dict:
    """The create request body."""
    return {
        "name": NAME,
        "tags": ["unnamed", "clinician-update"],
        "conversation_config": {
            "agent": {
                "first_message": FIRST,
                "language": "en",
                "dynamic_variables": {
                    "dynamic_variable_placeholders": {
                        "clinician_update": "Week 0 check-in for a synthetic patient "
                                            "completed. No measure moved beyond its "
                                            "minimal detectable change this week.",
                    },
                },
                "prompt": {
                    "prompt": PROMPT,
                    # The same model the existing agent on this account uses, so it is
                    # known to work here. temperature 0 because this is a read-out.
                    "llm": "deepseek-v41-flash",
                    "temperature": 0.0,
                    "ignore_default_personality": True,
                },
            },
            "tts": {"voice_id": VOICE, "speed": 0.95, "stability": 0.6},
            # A handover note, not a conversation. Three minutes is generous.
            "conversation": {"max_duration_seconds": 180},
            "turn": {"turn_timeout": 10.0},
        },
    }


def call_api(method: str, path: str, payload: dict | None = None) -> dict:
    """One request to the convai API."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method,
                                 headers={"xi-api-key": cfg.eleven_key,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:400]
        except Exception:
            detail = ""
        return {"_error": f"HTTP {exc.code} {detail}"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"_error": str(exc)[:200]}


def existing() -> str:
    """The id of an agent already called NAME, or an empty string."""
    got = call_api("GET", "")
    for row in got.get("agents", []) or []:
        if str(row.get("name") or "") == NAME:
            return str(row.get("agent_id") or "")
    return ""


def main() -> int:
    """Create the agent, or report the one that is already there."""
    if not cfg.eleven_key:
        print("\n  No ELEVENLABS_API_KEY, so there is nothing to create against.\n")
        return 1

    have = existing()
    if have:
        print("")
        print(f"  An agent called {NAME!r} already exists.")
        print(f"  ELEVENLABS_AGENT_ID={have}")
        print("")
        return 0

    got = call_api("POST", "/create", body())
    if got.get("_error"):
        print("")
        print(f"  Could not create the agent: {got['_error']}")
        print("")
        return 1

    agent_id = str(got.get("agent_id") or "")
    print("")
    print(f"  Created {NAME!r}")
    print("")
    print("  Put this in .env, replacing the ecoRide id that is there now:")
    print("")
    print(f"    ELEVENLABS_AGENT_ID={agent_id}")
    print("")
    print("  It will not make a sound until the account has credits. The free tier is")
    print("  capped at 10000 characters and that is already spent.")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
