"""Red flag screen and the filter every patient facing line passes through.

A clinician must confirm this list before any non-teammate use.

The agent never diagnoses, never gives return-to-play or driving clearance, and never
gives medication advice. That is enforced twice: in the system prompt in llm.py, and
here in `clean`, which every line shown or spoken to a patient goes through.
"""

QUESTIONS = [
    {"key": "worsening_headache", "ask": "Is your headache getting worse rather than better?"},
    {"key": "repeated_vomiting", "ask": "Have you vomited more than once since the injury?"},
    {"key": "seizure", "ask": "Have you had a seizure, or any shaking you could not control?"},
    {"key": "increasing_confusion", "ask": "Have you felt more confused or harder to wake than before?"},
    {"key": "new_weakness_or_numbness", "ask": "Any new weakness, numbness or tingling in your arms or legs?"},
    {"key": "slurred_speech", "ask": "Has anyone said your speech sounds slurred, or does it feel that way to you?"},
    {"key": "unusual_drowsiness", "ask": "Are you unusually drowsy, or struggling to stay awake?"},
]

EMERGENCY = (
    "Thank you for telling me. Based on that answer I am stopping the check-in here. "
    "Please get medical help now: call your local emergency number, or go to the nearest "
    "emergency department. If someone is with you, tell them now and ask them to stay with "
    "you. I am contacting your clinician as well. We can do the check-in another day."
)

# Phrases that must never reach a patient. The test checks exactly these four stems.
BANNED = ["diagnos", "cleared to", "return to play", "medication dose"]
SAFE_REDIRECT = (
    "That is a question for your clinician, and I will pass it on. I measure and I report, "
    "and they decide."
)


def questions() -> list[dict]:
    """The red flag screen, in order."""
    return [dict(q) for q in QUESTIONS]


def any_yes(answers: dict) -> bool:
    """True when any red flag question was answered yes."""
    return any(bool(answers.get(q["key"])) for q in QUESTIONS)


def flagged(answers: dict) -> list[str]:
    """Keys of the red flags that were answered yes."""
    return [q["key"] for q in QUESTIONS if bool(answers.get(q["key"]))]


def parse_yes(text: str) -> bool | None:
    """Read a yes or no out of a spoken answer, or None when it is neither."""
    low = f" {str(text).strip().lower()} "
    for word in (" no ", " nope ", " nah ", " negative ", " none ", " not really "):
        if word in low:
            return False
    for word in (" yes ", " yeah ", " yep ", " yup ", " correct ", " i have ", " i did ", " a bit "):
        if word in low:
            return True
    return None


def violations(text: str) -> list[str]:
    """Which banned stems appear in a line."""
    low = str(text).lower()
    return [b for b in BANNED if b in low]


def clean(text: str) -> str:
    """Patient facing text with any banned line replaced by the redirect.

    Called on every line before it is spoken or stored, so a bad LLM completion cannot
    reach a patient even if the system prompt failed to stop it.
    """
    bad = violations(text)
    if not bad:
        return str(text)
    return SAFE_REDIRECT


def screen(answers: dict) -> dict:
    """Run the screen. Returns whether to stop, the script to say and the flags."""
    hits = flagged(answers)
    if hits:
        return {"stop": True, "say": EMERGENCY, "flags": hits}
    return {
        "stop": False,
        "say": "Good, none of those. We can carry on with the check-in.",
        "flags": [],
    }


def short_version(symptoms: dict, jump: float = 0.0) -> bool:
    """Whether to run the short script.

    rule: headache >= 8, or fatigue >= 8, or the symptom total rose by 10 or more
    during eye block A
    """
    head = float(symptoms.get("headache", 0) or 0)
    fat = float(symptoms.get("fatigue", 0) or 0)
    return head >= 8 or fat >= 8 or float(jump) >= 10.0
