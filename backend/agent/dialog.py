"""The state machine that walks the call script.

For each step it speaks the line, sends the stimulus command, collects the frames and
audio for that task, calls the feature function, stores what came back, and moves on.
It handles "can you repeat that" and pauses, and it stops dead on a red flag.

The rig passes in a `hub` object with speak, show, flash and collect. The mock rig and
the real rig implement the same four methods, so this file does not know which it is on.
"""

import time

from .. import db
from ..features import pipeline
from . import llm, safety, script, summary

NS = 1_000_000_000
PAUSE_S = 20.0       # how long to wait when the patient asks for a break
MAX_REPEATS = 2      # an instruction is repeated at most twice before moving on


def run(hub, pid: str, week: int) -> dict:
    """Walk the script for one call and return the session plus the transcript."""
    row = db.patient(pid)
    name = str(row["name"]) if row else "there"
    log: list[dict] = []
    t0 = time.monotonic_ns()

    def say(text: str) -> None:
        """Speak one line, filtered, and record it."""
        line = safety.clean(text)
        hub.speak(line)
        log.append({"who": "agent", "text": line, "t": round((time.monotonic_ns() - t0) / NS, 2)})

    def heard(text: str) -> None:
        """Record what the patient said."""
        log.append({"who": "patient", "text": str(text), "t": round((time.monotonic_ns() - t0) / NS, 2)})

    # Consent and the red flag screen come before anything is measured.
    first = script.step_of("consent")
    say(llm.say_step(first, name, week))
    answers = {}
    for q in safety.questions():
        said = collect_answer(hub, say, heard, q["ask"], name, first)
        answers[q["key"]] = bool(safety.parse_yes(said))
    got = safety.screen(answers)
    if got["stop"]:
        say(got["say"])
        hub.show("blank", {})
        return stop_early(hub, pid, week, log, answers, got["flags"])
    say(got["say"])

    # Setup: quality gate and the nine point calibration.
    step = script.step_of("setup")
    say(llm.say_step(step, name, week))
    hub.show("calib", {"dots": 9})
    hub.collect("calib", 9.5)
    flash = hub.flash_block(10)
    eye_ok = bool(hub.quality_ok())
    if not eye_ok:
        say("The video is not clear enough for the eye tasks today, so I will skip those "
            "and we will do the rest. Nothing to worry about, we try again next week.")

    # Baseline symptoms, read one item at a time.
    step = script.step_of("symptoms")
    say(llm.say_step(step, name, week))
    symptoms = {}
    for key in script.SYMPTOMS:
        said = collect_answer(hub, say, heard, script.symptom_line(key), name, step)
        symptoms[key] = score_of(said)

    # Memory encoding.
    step = script.step_of("memory_encode")
    say(llm.say_step(step, name, week))
    from ..features import memory as memmod

    say(memmod.encode_line())
    said = collect_answer(hub, say, heard, "Go ahead, as many as you remember.", name, step)
    immediate = words_of(said)

    short = safety.short_version(symptoms, 0.0)
    plan = script.plan(short=short, flash_ok=flash["flash_ok"], eye_ok=eye_ok)
    done = ["consent", "setup", "symptoms", "memory_encode"]

    rerate = dict(symptoms)
    delayed: list[str] = []
    fluency: list[str] = []
    npc = None

    for step in plan:
        if step["id"] in done:
            continue
        say(llm.say_step(step, name, week))

        if step["id"] == "eye_a":
            hub.show("pursuit_h", {"amp": 0.35, "freq": 0.4})
            hub.collect("pursuit_h", 20.0)
            hub.show("pursuit_v", {"amp": 0.35, "freq": 0.3})
            hub.collect("pursuit_v", 20.0)
            hub.show("saccade", {"trials": 10})
            hub.collect("saccade", 20.0)
            for key in ("headache", "dizziness", "blurred_vision"):
                said = collect_answer(hub, say, heard, script.symptom_line(key), name, step)
                rerate[key] = score_of(said)
            jump = sum(rerate.values()) - sum(symptoms.values())
            if safety.short_version(rerate, jump) and not short:
                short = True
                say("Your symptoms have come up a bit, so I am going to shorten the rest of "
                    "this. We will stop the eye tasks here.")
                plan = [s for s in plan if s["id"] not in script.SHORT_DROP]

        elif step["id"] == "eye_b":
            hub.show("antisaccade", {"trials": 20})
            hub.collect("antisaccade", 40.0)
            hub.show("fixation", {"seconds": 10})
            hub.collect("fixation", 10.0)
            hub.show("npc", {})
            said = collect_answer(hub, say, heard, "Say now when the dot goes double.", name, step)
            npc = score_of(said) or 7.0

        elif step["id"] == "numbers":
            hub.show("digits", {"cards": 4})
            hub.collect("numbers", 40.0)

        elif step["id"] == "speech":
            hub.show("blank", {})
            hub.collect("ah", 25.0)
            hub.collect("ptk", 15.0)
            hub.collect("passage", 45.0)

        elif step["id"] == "picture":
            hub.show("picture", {})
            hub.collect("picture", 60.0)

        elif step["id"] == "fluency":
            said = collect_answer(hub, say, heard, "Go.", name, step, wait=62.0)
            fluency = words_of(said)

        elif step["id"] == "recall":
            said = collect_answer(hub, say, heard, "As many as you remember.", name, step)
            delayed = words_of(said)

        elif step["id"] == "wrap":
            hub.show("avatar_idle", {})

        done.append(step["id"])

    sess = hub.session({
        "symptoms": rerate,
        "recall_immediate": immediate,
        "recall_delayed": delayed,
        "fluency": fluency,
        "npc_cm": npc,
    })
    hist = db.observations(pid)
    prev = next((h["values"] for h in reversed(hist) if int(h["week"]) < week), None)
    base = next((h["values"] for h in hist if int(h["week"]) == 0), None)
    got = pipeline.run(sess, prev=prev, age=int(row["age"] or 30), sex=str(row["sex"]), baseline=base)

    note = summary.patient_text(name, week, got)
    say(note)
    return {
        "session": sess,
        "pipeline": got,
        "transcript": log,
        "steps": done,
        "short": short,
        "red_flags": [],
        "duration_s": round((time.monotonic_ns() - t0) / NS, 1),
        "patient_note": note,
    }


def collect_answer(hub, say, heard, prompt: str, name: str, step: dict, wait: float = 12.0) -> str:
    """Ask, listen, and handle repeats, pauses and off script answers."""
    say(prompt)
    repeats = 0
    while True:
        said = str(hub.listen(wait) or "")
        heard(said)
        if not said.strip():
            if repeats >= MAX_REPEATS:
                return ""
            repeats += 1
            say("I did not catch that, could you say it again?")
            continue
        if llm.wants_repeat(said) and repeats < MAX_REPEATS:
            repeats += 1
            say(llm.off_script(said, step, name))
            say(prompt)
            continue
        if llm.wants_pause(said):
            say("Of course, take your time. Tell me when you are ready.")
            hub.wait(PAUSE_S)
            say(prompt)
            continue
        return said


def score_of(said: str) -> float | None:
    """A 0 to 10 number out of a spoken answer, or None."""
    import re

    hit = re.search(r"\b(10|[0-9])(?:\.[0-9])?\b", str(said))
    return float(hit.group(0)) if hit else None


def words_of(said: str) -> list[str]:
    """Split a spoken list into words."""
    import re

    return [w for w in re.split(r"[,\s]+", str(said).lower()) if w.isalpha()]


def stop_early(hub, pid: str, week: int, log: list[dict], answers: dict, flags: list[str]) -> dict:
    """Package a call that stopped on a red flag. No measurements are taken."""
    from .. import alerts
    from ..comms import clinic_call

    alerts.red_flag(pid, answers)
    row = db.patient(pid)
    clinic_call.call(pid, summary.clinician_text(str(row["name"]), week, None, flags))
    return {
        "session": None,
        "pipeline": None,
        "transcript": log,
        "steps": ["consent"],
        "short": True,
        "red_flags": flags,
        "duration_s": 60.0,
        "patient_note": safety.EMERGENCY,
    }
