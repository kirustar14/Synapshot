"""The bridge between the sync call loop and the async websockets, plus the two hubs.

`dialog.run` drives a hub with eight methods. `MockHub` replays a generated session and
`LiveHub` drives the real rig, and they implement the same eight, so the dialog never
knows which one it is on. The websockets are async and the call loop is sync, so outbound
messages are scheduled onto the stored event loop and inbound ones land in a deque.
"""

import asyncio
import threading
import time
from collections import deque

from . import alerts, db, demo
from .agent import dialog
from .config import cfg
from .features import pipeline, sem as semmod, synth

LOOP: asyncio.AbstractEventLoop | None = None
STIM: list = []            # connected stimulus pages
RIG: list = []             # connected rig consoles
STIM_IN: deque = deque(maxlen=400)   # messages back from the stimulus page
STATE: dict = {"running": False, "pid": None, "week": None, "step": "", "line": None}
NS = 1_000_000_000


def set_loop(loop) -> None:
    """Remember the event loop so the sync call loop can reach the sockets."""
    global LOOP
    LOOP = loop


def _fan(socks: list, msg: dict) -> None:
    """Send one message to every live socket, dropping the dead ones."""
    async def go():
        dead = []
        for ws in list(socks):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in socks:
                socks.remove(ws)

    if LOOP is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(go(), LOOP)
    except RuntimeError:
        pass


def stim_send(msg: dict) -> None:
    """Send a command to the stimulus page."""
    _fan(STIM, msg)


def rig_event(event: dict) -> None:
    """Push a RigEvent to every rig console."""
    _fan(RIG, event)


def stim_in(msg: dict) -> None:
    """Record a message coming back from the stimulus page."""
    STIM_IN.append({**msg, "at_ns": time.monotonic_ns()})


def wait_for(kind: str, seconds: float = 2.0) -> dict | None:
    """Wait for one kind of stimulus message, or give up."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        for msg in list(STIM_IN):
            if msg.get("type") == kind:
                STIM_IN.remove(msg)
                return msg
        time.sleep(0.01)
    return None


def frame_event(step: str, gaze: tuple, target: tuple, quality: dict, gain, line, frame: str | None = None) -> None:
    """Build and send one RigEvent in the contract shape."""
    rig_event({
        "type": "frame",
        "gaze": {"x": float(gaze[0]), "y": float(gaze[1])},
        "target": {"x": float(target[0]), "y": float(target[1])},
        "quality": quality,
        "pursuit_gain": None if gain is None else float(gain),
        "step": step,
        "line": line,
        **({"frame": frame} if frame else {}),
    })


class MockHub:
    """Replays a generated session through the same websocket events as a real call."""

    def __init__(self, pid: str, week: int, values: dict, poor: bool = False):
        """Build the session up front from this week's true values."""
        row = db.patient(pid)
        self.pid = pid
        self.week = int(week)
        self.values = dict(values)
        self.poor = bool(poor)
        self.sess = synth.session(self.values, seed=int(row["seed"] or 0) * 100 + int(week), poor=poor)
        self.said = {"recall": 0}
        self.lines: list[str] = []
        self.step = "consent"

    def speak(self, text: str) -> None:
        """Agent line: log it, move the avatar's mouth, push it to the console."""
        self.lines.append(text)
        stim_send({"type": "avatar", "state": "talking"})
        frame_event(self.step, (0.5, 0.5), (0.5, 0.5), self.quality(), None,
                    {"who": "agent", "text": text})
        stim_send({"type": "avatar", "state": "idle"})

    def show(self, kind: str, params: dict) -> None:
        """Send the stimulus command the real page would get."""
        self.step = kind
        stim_send({"type": "show", "kind": kind, "params": params or {}})

    def flash_block(self, trials: int = 10) -> dict:
        """Report the flash test result the generated session was built with."""
        for _ in range(trials):
            stim_send({"type": "flash"})
        from .features import flash as flashmod

        t, lum = flashmod.lum_of(self.sess["frames"])
        return flashmod.test_block(t, lum, self.sess["flashes"])

    def collect(self, task: str, seconds: float) -> None:
        """Stream the generated frames for one task to the console, fast."""
        wins = {w["kind"]: w for w in pipeline.windows(self.sess["stim"])}
        win = wins.get(task)
        frames = pipeline.in_window(self.sess["frames"], win) if win else []
        gain = self.values.get("pursuit_gain")
        for i, f in enumerate(frames[::15]):
            tx = 0.5
            frame_event(task, f["ratio"], (tx, 0.5), self.quality(), gain, None)
            del i
        time.sleep(0.02)

    def listen(self, seconds: float, prompt: str = "") -> str:
        """Scripted answer for whatever was just asked."""
        ans = self.sess["answers"]
        low = str(prompt).lower()
        if "0 to 10" in low:
            key = low.split(",")[0].strip().replace(" ", "_")
            return str(ans["symptoms"].get(key, 2))
        if "double" in low:
            return f"now, about {ans['npc_cm']:.0f} centimetres"
        if "animals" in low or low.strip() == "go.":
            return ", ".join(ans["fluency"])
        if "remember" in low:
            self.said["recall"] += 1
            words = ans["recall_immediate"] if self.said["recall"] == 1 else ans["recall_delayed"]
            return ", ".join(words)
        for q in dialog.safety.questions():
            if q["ask"].lower()[:24] in low:
                return "no"
        return "okay"

    def wait(self, seconds: float) -> None:
        """A pause the patient asked for. Mock does not actually wait the full time."""
        time.sleep(min(0.1, seconds))

    def quality(self) -> dict:
        """Live quality flags for the console."""
        return {"face": not self.poor, "dist": True, "light": not self.poor,
                "fps": 30.0 if not self.poor else 14.0}

    def quality_ok(self) -> bool:
        """Whether the eye tasks may run."""
        return not self.poor

    def session(self, answers: dict) -> dict:
        """The generated session with the collected answers merged in."""
        out = dict(self.sess)
        merged = dict(self.sess["answers"])
        for key, val in (answers or {}).items():
            if val:
                merged[key] = val
        out["answers"] = merged
        return out


class LiveHub:
    """Drives the real rig: FaceTime audio, screen capture and the stimulus page."""

    def __init__(self, pid: str, week: int):
        """Start the capture ring buffer and sync the stimulus page to the Mac clock."""
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from rig import audio, capture

        self.audio = audio
        self.capture = capture
        self.pid = pid
        self.week = int(week)
        self.ring = capture.ring()
        self.stim: list[dict] = []
        self.calib: list[dict] = []
        self.flashes: list[float] = []
        self.trials: dict = {"saccade": [], "antisaccade": []}
        self.audio_tasks: dict = {}
        self.words: list[dict] = []
        self.t0_ns = time.monotonic_ns()
        self.step = "consent"
        stim_send({"type": "clock", "mono_ns": time.monotonic_ns(), "perf_ns": 0})

    def speak(self, text: str) -> None:
        """Say the line into FaceTime with the avatar's mouth moving."""
        self.step = self.step or "speak"
        stim_send({"type": "avatar", "state": "talking"})
        frame_event(self.step, (0.5, 0.5), (0.5, 0.5), self.quality(), None,
                    {"who": "agent", "text": text})
        self.audio.speak(text)
        stim_send({"type": "avatar", "state": "idle"})

    def show(self, kind: str, params: dict) -> None:
        """Command the page and record when it actually painted."""
        self.step = kind
        stim_send({"type": "show", "kind": kind, "params": params or {}})
        got = wait_for("shown", 2.0)
        t_ns = int(got["t_ns"]) if got and got.get("t_ns") else time.monotonic_ns()
        self.stim.append({"t_ns": t_ns, "kind": kind, "params": params or {}})
        if kind == "calib":
            from .features import gaze as gz

            for i, (sx, sy) in enumerate(gz.DOTS):
                self.calib.append({"t_ns": t_ns + int(i * gz.HOLD_S * NS), "sx": sx, "sy": sy})

    def flash_block(self, trials: int = 10) -> dict:
        """Fire the test flashes and look for them coming back in the video."""
        from .features import flash as flashmod

        times = []
        for _ in range(trials):
            stim_send({"type": "flash"})
            got = wait_for("flashed", 1.0)
            t_ns = int(got["t_ns"]) if got and got.get("t_ns") else time.monotonic_ns()
            times.append((t_ns - self.t0_ns) / NS)
            time.sleep(1.5)
        frames = list(self.ring["frames"])
        t, lum = flashmod.lum_of(frames)
        self.flashes = times
        return flashmod.test_block(t, lum, times)

    def collect(self, task: str, seconds: float) -> None:
        """Let the ring buffer fill for the task, recording audio for the spoken ones."""
        if task in ("ah", "ptk", "passage", "numbers", "picture"):
            self.audio_tasks[task] = self.audio.record(seconds)
            if task in ("passage", "numbers"):
                self.add_words(task, self.audio_tasks[task])
            return
        start = time.monotonic_ns()
        time.sleep(max(0.0, seconds))
        if task in ("saccade", "antisaccade"):
            self.read_trials(task, start)

    def read_trials(self, task: str, start_ns: int) -> None:
        """Record the trial flash times the page reported during a step task."""
        base = (start_ns - self.t0_ns) / NS
        out = []
        for msg in list(STIM_IN):
            if msg.get("type") != "flashed":
                continue
            STIM_IN.remove(msg)
            rel = (int(msg["t_ns"]) - start_ns) / NS
            if rel < 0:
                continue
            out.append({"side": 1 if len(out) % 2 == 0 else -1, "t_f": rel})
        self.trials[task] = out
        del base

    def add_words(self, task: str, wave) -> None:
        """Transcribe one spoken task and tag its words."""
        from .features import speech

        got = speech.transcribe(wave, self.audio.SR)
        for w in got["words"]:
            self.words.append({**w, "task": task})

    def listen(self, seconds: float, prompt: str = "") -> str:
        """Record the patient and transcribe it."""
        del prompt
        return self.audio.transcribe(self.audio.record(seconds))

    def wait(self, seconds: float) -> None:
        """Hold for a pause the patient asked for."""
        time.sleep(seconds)

    def quality(self) -> dict:
        """Live quality flags from the most recent frames."""
        from .features import quality as q

        frames = list(self.ring["frames"])[-60:]
        return {
            "face": q.face_share(frames) > q.FACE_SHARE,
            "dist": q.IRIS_PX_LO <= q.distance_px(frames) <= q.IRIS_PX_HI,
            "light": q.BRIGHT_LO <= q.brightness(frames) <= q.BRIGHT_HI,
            "fps": round(q.fps_of(frames), 1),
        }

    def quality_ok(self) -> bool:
        """Whether the quality gate lets the eye tasks run."""
        from .features import quality as q

        return bool(q.gates(list(self.ring["frames"]), 3, 0.0)["ok"])

    def session(self, answers: dict) -> dict:
        """Everything the call captured, in the session shape the pipeline reads."""
        self.capture.stop(self.ring)
        return {
            "t0_ns": self.t0_ns,
            "frames": list(self.ring["frames"]),
            "stim": self.stim,
            "calib": self.calib,
            "flashes": self.flashes,
            "trials": self.trials,
            "words": self.words,
            "audio": {"wave": None, "sr": self.audio.SR},
            "audio_tasks": self.audio_tasks,
            "answers": answers or {},
            "seconds": (time.monotonic_ns() - self.t0_ns) / NS,
        }


def hub_for(pid: str, week: int, values: dict, poor: bool = False):
    """The live rig when it is configured, otherwise the mock."""
    if cfg.mock_rig:
        return MockHub(pid, week, values, poor)
    try:
        return LiveHub(pid, week)
    except Exception:
        return MockHub(pid, week, values, poor)


def run_call(pid: str, week: int | None = None) -> dict:
    """One full call: dialog, pipeline, check-in, EnKF update, alerts, summary."""
    row = db.patient(pid)
    if row is None:
        return {"ok": False, "error": "no such patient"}
    week = int(row["week"] or 0) + 1 if week is None else int(week)
    truth = demo.truth_of(pid)
    if week not in truth:
        truth[week] = demo.extend_truth(pid, truth, week)
        demo.set_truth(pid, truth)
    poor = demo.profile_of(pid) == "low_quality"

    hub = hub_for(pid, week, truth[week], poor)
    STATE.update({"running": True, "pid": pid, "week": week, "step": "start"})
    try:
        got = dialog.run(hub, pid, week)
    finally:
        STATE.update({"running": False, "step": "done"})

    if got["red_flags"]:
        db.event(pid, "call_red_flag", {"week": week, "flags": got["red_flags"]})
        return {"ok": True, "week": week, "red_flags": got["red_flags"], "mock": isinstance(hub, MockHub),
                "transcript": got["transcript"]}

    res = got["pipeline"]
    cid = store_checkin(pid, week, got, res)
    out = demo.assimilate(pid, week, pipeline.observables(res["values"]), res["channel"])
    from .agent import summary
    from .comms import notify as texter

    texter.send(pid, "post_call", body=got["patient_note"])
    if out["alerts"]:
        from .comms import clinic_call

        clinic_call.call(pid, summary.clinician_text(str(row["name"]), week, res))
    return {
        "ok": True, "week": week, "checkin_id": cid, "mock": isinstance(hub, MockHub),
        "alerts": out["alerts"], "drift_z": out["diag"]["drift_z"],
        "features": len(res["features"]), "duration_s": got["duration_s"],
    }


def store_checkin(pid: str, week: int, got: dict, res: dict) -> str:
    """Store the check-in the call produced."""
    cid = db.new_id("chk")
    db.put("checkins", {
        "id": cid, "patient_id": pid, "week": int(week), "date": db.now(),
        "duration_s": float(got["duration_s"]), "steps": db.enc(got["steps"]),
        "channel": db.enc(res["channel"]), "features": db.enc(res["features"]),
        "gaze": db.enc(res["gaze"]), "traces": db.enc(res["traces"]),
        "transcript": db.enc(got["transcript"]), "unusable": int(not res["quality"]["ok"]),
    })
    for key, val in pipeline.observables(res["values"]).items():
        db.add_observation(pid, week, key, float(val), semmod.sem(key))
    db.patch("patients", pid, {"last_call": db.now(), "week": int(week)})
    return cid


def start_call(pid: str, week: int | None = None) -> dict:
    """Kick a call off on a background thread so the request can return."""
    if STATE["running"]:
        return {"ok": False, "error": "a call is already running", "state": dict(STATE)}
    out: dict = {}

    def go():
        try:
            out.update(run_call(pid, week))
        except Exception as exc:
            out.update({"ok": False, "error": str(exc)})
            db.event(pid, "call_failed", {"error": str(exc)})
            alerts.missed(pid, int(week or 0))

    thread = threading.Thread(target=go, daemon=True)
    thread.start()
    return {"ok": True, "started": True, "patient_id": pid}
