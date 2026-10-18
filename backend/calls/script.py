"""The call script. The page renders whatever this returns, in order.

One task per screen. The short version is the default on stage: consent, red flags,
calibration, symptoms, pursuit, antisaccades, fixation, reading, recall and a wrap, which
runs in about four minutes. The full script adds the rest and is reached with ?full=1.

Every `say` line goes through the banned phrase filter before it leaves here, so no
route can serve a line that was not filtered.
"""

from ..agent import safety
from ..features import memory

# The eight symptom items the patient rates 0 to 10, in the order they are asked.
SYMPTOMS = ["headache", "pressure", "neck_pain", "nausea", "dizziness",
            "blurred_vision", "light_sensitivity", "fatigue"]

PICTURE = "kitchen"
FLUENCY_S = 60
PASSAGE = (
    "The north wind and the sun were disputing which was the stronger, when a traveller "
    "came along wrapped in a warm cloak. They agreed that the one who first succeeded in "
    "making the traveller take his cloak off should be considered stronger than the other."
)

# id, say, task, minutes, tier, block. One task per screen, in the order the page runs.
STEPS = [
    ("redflags",
     "First, seven quick safety questions. Answer yes or no to each one.",
     "redflags", 1.0, "safety", None),
    ("quality",
     "Now prop the phone up about an arm's length away, at eye level, with the light on "
     "your face. I will check the camera can see you clearly.",
     "quality", 1.0, "gate", None),
    ("calib",
     "Nine dots will appear one at a time. Look straight at each one as it shows up, and "
     "keep your head still.",
     "calib", 1.0, "gate", None),
    ("symptoms",
     "I will show eight symptoms. For each one, tap a number from 0 to 10, where 0 is "
     "none and 10 is the worst you can imagine.",
     "symptoms", 1.0, "A", None),
    ("encode",
     "I am going to show fifteen words, one at a time. Read each one out loud and try to "
     "remember them. I will ask for them twice, once now and once at the end.",
     "encode", 1.0, "A", None),
    ("pursuit_h",
     "Follow the dot with your eyes only. Keep your head still.",
     "pursuit_h", 0.5, "A", "A"),
    ("pursuit_v",
     "Same again, this time the dot moves up and down. Eyes only.",
     "pursuit_v", 0.5, "A", "A"),
    ("saccade",
     "The dot will jump from side to side. Look at it as fast as you can each time it "
     "moves.",
     "saccade", 0.6, "B", "A"),
    ("symptoms_rerate",
     "Quick check. Tap a number from 0 to 10 for these three.",
     "symptoms", 0.4, "A", "A"),
    ("antisaccade",
     "This one is the opposite. When the dot appears on one side, look away from it, to "
     "the other side.",
     "antisaccade", 0.8, "B", "B"),
    ("fixation",
     "Hold your eyes on the centre dot and keep them there. Ten seconds.",
     "fixation", 0.3, "A", "B"),
    ("npc",
     "Hold your thumb out at arm's length and look at it. Bring it slowly in toward your "
     "nose, and tap when it goes double.",
     "npc", 0.4, "B", "B"),
    ("speech_ah",
     "Take a breath and say ah for as long as you can, in one steady note.",
     "speech_ah", 0.5, "A", None),
    ("speech_pataka",
     "Now say pa-ta-ka over and over, as fast as you can and as clearly as you can.",
     "speech_pataka", 0.3, "A", None),
    ("speech_passage",
     "Read the passage on the screen out loud, at your normal speed.",
     "speech_passage", 0.6, "A", None),
    ("picture",
     "Describe what you see in this picture, in as much detail as you like, for about a "
     "minute.",
     "picture", 1.0, "A", None),
    ("fluency",
     "Name as many animals as you can. You have sixty seconds. Go.",
     "fluency", 1.0, "B", "B"),
    ("recall",
     "Back to the fifteen words from earlier. Say as many as you can remember now, in any "
     "order.",
     "recall", 0.75, "A", None),
    ("wrap",
     "That is everything. Thank you. I am working out your summary now, it takes a few "
     "seconds.",
     "wrap", 0.75, "none", None),
]

# Steps dropped when symptoms are high or jump mid-call: eye block B and fluency. A
# patient who is already struggling is not asked to do the hardest tasks.
SHORT_DROP = ["antisaccade", "fixation", "npc", "fluency"]

# The brief script is the default. It is the eleven screens that still give a usable week
# of measurements in about four minutes: the safety screen, both gates, symptoms, word
# encoding and recall, one pursuit axis, antisaccades, fixation and one read passage.
#
# This is a real tradeoff, not a free saving. Ten antisaccade trials estimate the error
# rate with a standard error around 15 percentage points where twenty halve that, and
# dropping pursuit_v, saccade, npc, the two oral motor tasks, the picture description and
# fluency means those features are simply absent for the week rather than measured
# poorly. Nothing is invented to fill them in: the filter assimilates what arrived and the
# band widens where it did not. The full fourteen minute protocol is one query away.
#
# Entries are (step id, minutes in the brief version, parameter overrides).
BRIEF = [
    ("redflags", 0.5, {}),
    ("quality", 0.5, {"seconds": 6}),
    ("calib", 0.4, {"hold_ms": 900}),
    ("symptoms", 0.5, {}),
    ("encode", 0.5, {}),
    ("pursuit_h", 0.25, {"seconds": 10}),
    ("antisaccade", 0.4, {"trials": 10}),
    ("fixation", 0.2, {}),
    ("speech_passage", 0.35, {"seconds": 25}),
    ("recall", 0.3, {"seconds": 25}),
    ("wrap", 0.2, {}),
]
BRIEF_IDS = [sid for sid, _, _ in BRIEF]
BRIEF_MINUTES = {sid: mins for sid, mins, _ in BRIEF}
BRIEF_PARAMS = {sid: over for sid, _, over in BRIEF}

# Tasks the brief script does not run, so the one place that has to know is this one.
BRIEF_MISSING = [sid for sid, *_ in STEPS if sid not in set(BRIEF_IDS)]

PARAMS = {
    "quality": {"flashes": 10, "seconds": 8},
    "calib": {"dots": 9, "hold_ms": 1000, "settle_ms": 350},
    "symptoms": {"items": SYMPTOMS, "max": 10},
    "symptoms_rerate": {"items": ["headache", "dizziness", "blurred_vision"], "max": 10},
    "encode": {"word_ms": 2000},
    "pursuit_h": {"amp": 0.35, "freq": 0.4, "seconds": 20},
    "pursuit_v": {"amp": 0.35, "freq": 0.3, "seconds": 20},
    "saccade": {"trials": 10, "amp": 0.3, "gap_ms": 2000, "hold_ms": 1200},
    "antisaccade": {"trials": 20, "amp": 0.3, "gap_ms": 2000, "hold_ms": 1200},
    "fixation": {"seconds": 10},
    "npc": {"max_cm": 30},
    "speech_ah": {"seconds": 25},
    "speech_pataka": {"seconds": 15},
    "speech_passage": {"seconds": 45},
    "picture": {"seconds": 60, "scene": PICTURE},
    "fluency": {"seconds": FLUENCY_S, "category": "animals"},
    "recall": {"seconds": 45},
    "redflags": {"items": [q["key"] for q in safety.questions()]},
}


def steps(short: bool = False, full: bool = True) -> list[dict]:
    """The step list, already filtered for banned phrases.

    `full` is the whole fourteen minute protocol. `full=False` is the four minute brief
    version the call page serves by default. `short` is the separate symptom triggered
    rule: it drops the hardest eye tasks for a patient who is already struggling, and it
    applies to either length.
    """
    brief = set(BRIEF_IDS)
    out = []
    for sid, say, task, minutes, tier, block in STEPS:
        if not full and sid not in brief:
            continue
        if short and sid in SHORT_DROP:
            continue
        params = dict(PARAMS.get(sid, {}))
        if not full:
            params.update(BRIEF_PARAMS.get(sid, {}))
        row = {
            "id": sid,
            "say": safety.clean(say),
            "task": task,
            "minutes": float(minutes if full else BRIEF_MINUTES.get(sid, minutes)),
            "tier": tier,
            "params": params,
        }
        if block:
            row["block"] = block
        out.append(row)
    return out


def step_of(sid: str) -> dict:
    """One step by id."""
    for step in steps():
        if step["id"] == sid:
            return step
    raise KeyError(sid)


def ids(short: bool = False, full: bool = True) -> list[str]:
    """Step ids in order."""
    return [s["id"] for s in steps(short=short, full=full)]


def minutes(short: bool = False, full: bool = True) -> float:
    """Total minutes of the script."""
    return round(sum(s["minutes"] for s in steps(short=short, full=full)), 2)


def lines() -> list[str]:
    """Every patient facing line the web call can speak, for the safety test.

    Includes the step lines, the consent paragraphs, the symptom and red flag prompts,
    the emergency wording and the safe redirect, because every one of them is generated
    as audio and every one of them has to pass the filter.
    """
    out = [s["say"] for s in steps()]
    out += consent_text()
    out += [symptom_line(k) for k in SYMPTOMS]
    out += [q["ask"] for q in safety.questions()]
    out += [safety.EMERGENCY, safety.SAFE_REDIRECT]
    return [safety.clean(t) for t in out]


def voice_lines() -> list[dict]:
    """Every line that gets an mp3, with the id the file is named after."""
    out = [{"id": s["id"], "text": s["say"]} for s in steps()]
    for i, text in enumerate(consent_text()):
        out.append({"id": f"consent_{i + 1}", "text": safety.clean(text)})
    for q in safety.questions():
        out.append({"id": f"redflag_{q['key']}", "text": safety.clean(q["ask"])})
    for key in SYMPTOMS:
        out.append({"id": f"symptom_{key}", "text": safety.clean(symptom_line(key))})
    out.append({"id": "emergency", "text": safety.clean(safety.EMERGENCY)})
    out.append({"id": "redirect", "text": safety.clean(safety.SAFE_REDIRECT)})
    out.append({"id": "clear", "text": safety.clean(
        "Good, none of those. We can carry on with the check-in.")})
    return out


def symptom_line(key: str) -> str:
    """The prompt for one symptom item."""
    return f"{key.replace('_', ' ')}, 0 to 10?"


def consent_text() -> list[str]:
    """What the consent screen says, in plain language.

    The check-in happens in the phone's own browser and the video never leaves the phone:
    the phone works out the measurements and posts only the numbers. That is the whole
    privacy story and it is said out loud here rather than buried.
    """
    return [
        "This is a research check-in, not medical care. The assistant running it is "
        "software, not a person and not a clinician.",
        "It will never tell you what is wrong with you, and never tell you when you can "
        "go back to sport, work or driving. Those are your clinician's decisions.",
        "The check-in takes about fourteen minutes and runs in this browser. Your camera "
        "and microphone are used while it runs.",
        "The video never leaves your phone. Your phone works out the measurements from it "
        "and only those numbers are sent. Your recorded voice is sent for the speaking "
        "tasks, because the measurements need the sound itself.",
        "What is measured: eye movements, speech, memory, facial movement, and the symptom "
        "scores you tap in. Your clinician sees all of it.",
        "If you tick the separate genetic box, only four specific markers are read from the "
        "file you give us and the file is deleted straight afterwards. Nothing else in it "
        "is looked at or kept. That box is optional and off by default.",
        "You can stop at any time with the button at the top, and you can withdraw "
        "completely by replying STOP to any text.",
        "If anything you tell us suggests an emergency, the check-in stops and you will be "
        "told to get medical help immediately.",
    ]


def payload(short: bool = False, full: bool = False, audio: dict | None = None,
            voice_base: str = "/voice/") -> dict:
    """The CallScript contract object the page is driven by.

    The brief four minute script by default; `full` is the whole protocol, which the page
    asks for with ?full=1.
    """
    audio = audio or {}
    out = []
    for step in steps(short=short, full=full):
        row = dict(step)
        got = audio.get(step["id"])
        # One line, one file. `audio` maps a step id to either a file name or a
        # {file, duration_ms} record, and either way a step gets exactly one of each. A
        # step with no mp3 carries audio None and the page speaks the same `say` text
        # with the browser voice, so the line is never said twice and never said twice
        # over itself.
        if isinstance(got, dict):
            row["audio"] = got.get("file") or None
            row["duration_ms"] = got.get("duration_ms")
        elif got:
            row["audio"] = got
        if not row.get("audio"):
            row["audio"] = None
            row["fallback"] = "speech"
        out.append(row)
    return {
        "consent": consent_text(),
        "steps": out,
        "voice_base": voice_base,
        "symptom_items": list(SYMPTOMS),
        "redflag_items": [q["ask"] for q in safety.questions()],
        "words": list(memory.WORDS),
        "passage": PASSAGE,
        "picture": PICTURE,
        "fluency_seconds": FLUENCY_S,
        "full": bool(full),
        "minutes": minutes(short=short, full=full),
        # Said out loud rather than left to be noticed: these tasks did not run, so their
        # features are absent for the week instead of measured badly.
        "skipped": [] if full else list(BRIEF_MISSING),
    }
