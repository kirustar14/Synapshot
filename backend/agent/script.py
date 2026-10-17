"""The fourteen minute weekly call script, as a list of steps.

Each step: id, say (the line the agent opens with), task (what the rig does), minutes,
tier. Tier B steps are the ones that depend on the one frame flash clock or are reach
features, and they are the first thing dropped when the call has to be short.
"""

from . import safety

SYMPTOMS = ["headache", "pressure", "neck_pain", "nausea", "dizziness", "blurred_vision", "light_sensitivity", "fatigue"]

STEPS = [
    {
        "id": "consent",
        "say": "Hi, this is the UNNAMED check-in assistant. Before we start: this call is "
               "recorded and measured, you can stop any time by saying stop, and I am not a "
               "clinician. First, seven quick safety questions.",
        "task": "consent_and_red_flags",
        "minutes": 1.0,
        "tier": "A",
    },
    {
        "id": "setup",
        "say": "Now hold the phone about an arm's length away, at eye level, with light on "
               "your face. I am going to show nine dots, look at each one as it appears.",
        "task": "quality_gate_and_calibration",
        "minutes": 1.0,
        "tier": "A",
    },
    {
        "id": "symptoms",
        "say": "I will read eight symptoms. For each one, say a number from 0 to 10, where 0 "
               "is none and 10 is the worst you can imagine.",
        "task": "symptoms_baseline",
        "minutes": 1.0,
        "tier": "A",
    },
    {
        "id": "memory_encode",
        "say": "I am going to read fifteen words. Listen, and when I stop, say back as many "
               "as you can remember, in any order.",
        "task": "memory_encoding",
        "minutes": 1.0,
        "tier": "A",
    },
    {
        "id": "eye_a",
        "say": "Eye tasks. Keep your head still and follow the dot with your eyes only. Then "
               "some quick jumps, then I will ask about your symptoms again.",
        "task": "pursuit_h,pursuit_v,saccade_flash,symptoms_rerate",
        "minutes": 2.0,
        "tier": "A",
    },
    {
        "id": "eye_b",
        "say": "Next block. This time look away from the dot, to the opposite side. Then hold "
               "still on the centre dot, then follow my finger in toward your nose.",
        "task": "antisaccade,fixation,npc,symptoms",
        "minutes": 1.5,
        "tier": "B",
    },
    {
        "id": "numbers",
        "say": "Read these number cards out loud, left to right, as fast as you can without "
               "making mistakes.",
        "task": "rapid_number_naming",
        "minutes": 1.0,
        "tier": "B",
    },
    {
        "id": "speech",
        "say": "Speech. Take a breath and say ah for as long as you can. Then say pa-ta-ka "
               "over and over as fast as you can. Then read the short passage on screen.",
        "task": "sustained_ah,pa_ta_ka,passage",
        "minutes": 1.5,
        "tier": "A",
    },
    {
        "id": "picture",
        "say": "Describe what you see in this picture, in as much detail as you like, for "
               "about a minute.",
        "task": "picture_description",
        "minutes": 1.0,
        "tier": "A",
    },
    {
        "id": "fluency",
        "say": "Name as many animals as you can in sixty seconds. Go.",
        "task": "verbal_fluency",
        "minutes": 1.0,
        "tier": "B",
    },
    {
        "id": "recall",
        "say": "Back to the fifteen words from earlier. Tell me as many as you can remember now.",
        "task": "delayed_recall",
        "minutes": 0.75,
        "tier": "A",
    },
    {
        "id": "wrap",
        "say": "That is everything. I will text you a short summary, and your clinician sees "
               "the detail. Same time next week.",
        "task": "wrap_up",
        "minutes": 1.25,
        "tier": "A",
    },
]

SHORT_DROP = ["eye_b", "numbers", "fluency"]


def steps() -> list[dict]:
    """The full script."""
    return [dict(s) for s in STEPS]


def minutes(plan: list[dict] | None = None) -> float:
    """Total minutes of a plan, defaulting to the full script."""
    return round(sum(float(s["minutes"]) for s in (plan or STEPS)), 2)


def plan(short: bool = False, flash_ok: bool = True, eye_ok: bool = True) -> list[dict]:
    """The script to actually run.

    short      drops eye block B, number naming and fluency, per the short version rule
    flash_ok   false drops the steps whose measures need the one frame flash clock
    eye_ok     false drops every eye step, because the quality gate failed
    """
    out = []
    for step in steps():
        if short and step["id"] in SHORT_DROP:
            continue
        if not eye_ok and step["id"] in ("eye_a", "eye_b"):
            continue
        if not flash_ok and step["id"] == "eye_b":
            continue
        out.append(step)
    return out


def step_of(sid: str) -> dict:
    """One step by id."""
    for step in STEPS:
        if step["id"] == sid:
            return dict(step)
    raise KeyError(sid)


def symptom_line(name: str) -> str:
    """The line the agent reads for one symptom item."""
    label = name.replace("_", " ")
    return f"{label}, 0 to 10?"


def lines(step: dict) -> list[str]:
    """Every patient facing line of a step, already filtered for banned phrases."""
    out = [safety.clean(step["say"])]
    if step["id"] == "symptoms":
        out += [safety.clean(symptom_line(k)) for k in SYMPTOMS]
    if step["id"] == "consent":
        out += [safety.clean(q["ask"]) for q in safety.questions()]
    return out


def all_lines(short: bool = False) -> list[str]:
    """Every patient facing line of a whole call, for the safety test."""
    out = []
    for step in plan(short=short):
        out += lines(step)
    out.append(safety.EMERGENCY)
    out.append(safety.SAFE_REDIRECT)
    return out
