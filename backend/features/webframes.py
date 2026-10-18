"""Turn what the phone posts into the session dict the feature pipeline already reads.

The browser runs MediaPipe on the phone and posts FrameRecs, never video. This module
validates them, rejects impossible ones, and assembles the same session shape the
FaceTime rig produced, so every feature function downstream is reused untouched.

The one genuinely new measurement is camera latency. On FaceTime the stimulus and the
response were both read off the returned video, so the call delay cancelled. In the
browser the stimulus time comes off the page's own clock and the response comes off the
camera, so the gap between them has to be measured and removed:

    camera_latency = median over trials of (brightness rise in the frames) - (flash drawn)

Fewer than 8 of 10 flashes found, or a spread above 25 ms, and flash_ok is false and
every tier B measure is dropped for the call, exactly as before.
"""

import numpy as np
from pydantic import BaseModel, Field, field_validator

from . import flash as flashmod

MAX_FPS = 90.0
MIN_FLASH = 8
FLASH_TRIALS = 10
SD_GATE_MS = 25.0
NS = 1_000_000_000


class Ratio(BaseModel):
    """Iris position as a fraction of the eye opening, horizontal and vertical."""

    h: float = Field(ge=-1.0, le=2.0)
    v: float = Field(ge=-1.0, le=2.0)


class Iris(BaseModel):
    """Both iris centres in normalized image coordinates."""

    lx: float = Field(ge=-1.0, le=2.0)
    ly: float = Field(ge=-1.0, le=2.0)
    rx: float = Field(ge=-1.0, le=2.0)
    ry: float = Field(ge=-1.0, le=2.0)


class Head(BaseModel):
    """Head pose in degrees."""

    yaw: float = Field(ge=-90.0, le=90.0)
    pitch: float = Field(ge=-90.0, le=90.0)
    roll: float = Field(ge=-90.0, le=90.0)


class Ear(BaseModel):
    """Eye aspect ratio per eye."""

    l: float = Field(ge=0.0, le=1.0)
    r: float = Field(ge=0.0, le=1.0)


class Blend(BaseModel):
    """The three blendshapes the exploratory traces use."""

    smile: float = Field(default=0.0, ge=0.0, le=1.0)
    brow_down: float = Field(default=0.0, ge=0.0, le=1.0)
    jaw_open: float = Field(default=0.0, ge=0.0, le=1.0)


class FrameRec(BaseModel):
    """One video frame as the phone measured it. t and cap are ms on the browser clock."""

    t: float = Field(ge=0.0)
    cap: float | None = Field(default=None, ge=0.0)
    face: bool
    ratio: Ratio
    iris: Iris
    iris_px: float = Field(ge=0.0, le=400.0)
    head: Head
    ear: Ear
    bright: float = Field(ge=0.0, le=1.0)
    blend: Blend = Blend()


class StimEvent(BaseModel):
    """One thing the page drew. x and y are fractions of the canvas."""

    t: float = Field(ge=0.0)
    kind: str = Field(min_length=1, max_length=40)
    x: float | None = Field(default=None, ge=-0.5, le=1.5)
    y: float | None = Field(default=None, ge=-0.5, le=1.5)
    flash: bool | None = None
    trial: int | None = Field(default=None, ge=0, le=1000)
    side: str | None = None

    @field_validator("side")
    @classmethod
    def check_side(cls, val):
        """Side is L, R or nothing at all."""
        if val is None or val in ("L", "R"):
            return val
        raise ValueError("side must be L or R")


class Meta(BaseModel):
    """What the page is running on."""

    w_px: float = Field(gt=0, le=20000)
    h_px: float = Field(gt=0, le=20000)
    dpr: float = Field(gt=0, le=10)
    ua: str = Field(default="", max_length=400)
    fps: float = Field(ge=0.0, le=MAX_FPS)


class FramesBody(BaseModel):
    """Body of POST /api/call/{token}/frames. One task, one chunk."""

    task: str = Field(min_length=1, max_length=40)
    meta: Meta
    frames: list[FrameRec] = Field(default_factory=list, max_length=4000)
    stim: list[StimEvent] = Field(default_factory=list, max_length=4000)


def check_frames(frames: list[FrameRec], meta: Meta) -> None:
    """Reject a chunk whose timestamps are impossible. Raises ValueError with the reason."""
    if not frames:
        return
    t = np.array([f.t for f in frames], dtype=float)
    if np.any(np.diff(t) < 0):
        raise ValueError("frame timestamps are not increasing")
    span = float(t[-1] - t[0]) / 1000.0
    if span > 0 and (len(t) - 1) / span > MAX_FPS:
        raise ValueError(f"more than {MAX_FPS:.0f} frames per second")
    if meta.fps > MAX_FPS:
        raise ValueError(f"meta reports more than {MAX_FPS:.0f} fps")


def check_stim(stim: list[StimEvent]) -> None:
    """Reject a stimulus log that is out of order."""
    if not stim:
        return
    t = np.array([s.t for s in stim], dtype=float)
    if np.any(np.diff(t) < 0):
        raise ValueError("stimulus timestamps are not increasing")


def to_frame(rec: dict, t0_ms: float) -> dict:
    """One browser FrameRec as the internal frame record the pipeline reads.

    `cap` is the capture time when the browser gives us one, which is closer to when the
    photons arrived than when our JavaScript got round to the frame. It is used in
    preference to `t` for exactly that reason.
    """
    when = rec.get("cap") if rec.get("cap") else rec["t"]
    ear = rec.get("ear") or {}
    blend = rec.get("blend") or {}
    head = rec.get("head") or {}
    ratio = rec.get("ratio") or {}
    return {
        "t_ns": int((float(when) - t0_ms) * 1e6),
        "face": bool(rec.get("face")),
        "lum": float(rec.get("bright", 0.0)),
        "ratio": (float(ratio.get("h", 0.5)), float(ratio.get("v", 0.5))),
        "pose": (float(head.get("yaw", 0.0)), float(head.get("pitch", 0.0)), float(head.get("roll", 0.0))),
        "ear": float(0.5 * (float(ear.get("l", 0.3)) + float(ear.get("r", 0.3)))),
        "iris_px": float(rec.get("iris_px", 0.0)),
        # Mapped onto the blendshape names the existing traces already read. The web path
        # measures brow lowering where the FaceTime path measured brow raising, so the two
        # are not comparable week to week. See DECISIONS.md.
        "blend": {
            "mouthSmileLeft": float(blend.get("smile", 0.0)),
            "browDownLeft": float(blend.get("brow_down", 0.0)),
            "jawOpen": float(blend.get("jaw_open", 0.0)),
        },
    }


def camera_latency(frames: list[dict], flash_ms: list[float], t0_ms: float) -> dict:
    """How far behind the screen the camera is, from the test flashes.

    Returns the median delay in seconds, the spread, how many flashes came back, and
    whether the timing is good enough to report a tier B measure at all.
    """
    t, lum = flashmod.lum_of(frames)
    want = [(float(ms) - t0_ms) / 1000.0 for ms in flash_ms]
    hits = [flashmod.detect(t, lum, tf) for tf in want]
    lags = [h["t"] - tf for h, tf in zip(hits, want) if h["found"] and h["t"] is not None]
    found = len(lags)
    sd_ms = float(np.std(lags) * 1000.0) if found > 1 else 0.0
    med = float(np.median(lags)) if found else 0.0
    enough = found >= MIN_FLASH and len(want) >= MIN_FLASH
    steady = sd_ms <= SD_GATE_MS
    return {
        "latency_s": med if found else 0.0,
        "sd_ms": round(sd_ms, 2),
        "found": found,
        "trials": len(want),
        "need": MIN_FLASH,
        "flash_ok": bool(enough and steady),
        "why": "" if (enough and steady) else (
            f"only {found} of {len(want)} test flashes came back" if not enough
            else f"flash timing varied by {sd_ms:.0f} ms, gate is {SD_GATE_MS:.0f} ms"),
        "measured": True,
    }


def calib_dots(stim: list[dict], t0_ms: float) -> list[dict]:
    """The nine calibration dots with the exact screen coordinates the page drew.

    The dot positions are read off the stimulus log rather than assumed, so a page that
    laid the dots out differently still calibrates correctly.
    """
    out = []
    for ev in stim:
        if ev.get("kind") != "calib_dot" or ev.get("x") is None or ev.get("y") is None:
            continue
        out.append({"t_ns": int((float(ev["t"]) - t0_ms) * 1e6),
                    "sx": float(ev["x"]), "sy": float(ev["y"])})
    return out


def task_windows(stim: list[dict], t0_ms: float) -> list[dict]:
    """A stimulus log in the shape pipeline.windows expects, one entry per task start."""
    out = []
    for ev in stim:
        if ev.get("kind") != "task":
            continue
        out.append({
            "t_ns": int((float(ev["t"]) - t0_ms) * 1e6),
            "kind": str(ev.get("task") or ev.get("name") or ""),
            "params": ev.get("params") or {},
        })
    return out


def task_start(stim: list[dict], task: str) -> float | None:
    """Browser ms when one task began, from its own marker in the stimulus log."""
    for ev in stim:
        if ev.get("kind") == "task" and str(ev.get("task") or "") == task:
            return float(ev["t"])
    return None


def trials_of(stim: list[dict], lag_s: float, kind: str, task: str) -> list[dict]:
    """Trial flash times for a step task, on the same clock the gaze trace uses.

    Two shifts, both necessary. The gaze trace for a task starts its clock at the task's
    own first frame, so trial times are measured from the task start, not the session
    start. And the camera sees the eye move `lag_s` after the screen changed, so adding
    the lag puts the drawn jump and the captured response on one clock, which leaves the
    patient's latency rather than the patient's plus the camera's.
    """
    base = task_start(stim, task)
    if base is None:
        return []
    out = []
    for ev in stim:
        if ev.get("kind") != kind:
            continue
        side = 1 if str(ev.get("side") or "R") == "R" else -1
        out.append({"side": side, "t_f": (float(ev["t"]) - base) / 1000.0 + float(lag_s)})
    return out


def assemble(chunks: list[dict], answers: dict | None = None, audio_tasks: dict | None = None,
             words: list[dict] | None = None, extra: dict | None = None) -> dict:
    """One session dict out of every posted chunk, ready for pipeline.run.

    `chunks` are the stored {task, kind, payload} rows. Frames and stimulus events from
    every task are merged onto one clock that starts at the first frame. `extra` carries
    the few session level values speech.measure falls back on when there is no audio.
    """
    frames_raw: list[dict] = []
    stim_raw: list[dict] = []
    for chunk in chunks:
        if chunk["kind"] == "frames":
            frames_raw += list(chunk["payload"] or [])
        elif chunk["kind"] == "stim":
            stim_raw += list(chunk["payload"] or [])

    frames_raw.sort(key=lambda f: float(f.get("cap") or f.get("t") or 0.0))
    stim_raw.sort(key=lambda s: float(s.get("t") or 0.0))
    if not frames_raw:
        t0 = min([float(s.get("t") or 0.0) for s in stim_raw], default=0.0)
    else:
        t0 = float(frames_raw[0].get("cap") or frames_raw[0].get("t") or 0.0)

    frames = [to_frame(f, t0) for f in frames_raw]
    flash_ms = [float(s["t"]) for s in stim_raw if s.get("kind") == "test_flash"]
    lag = camera_latency(frames, flash_ms, t0)

    sess = {
        "t0_ns": int(t0 * 1e6),
        "frames": frames,
        "stim": task_windows(stim_raw, t0),
        "calib": calib_dots(stim_raw, t0),
        "flashes": [(ms - t0) / 1000.0 for ms in flash_ms],
        "trials": {
            "saccade": trials_of(stim_raw, lag["latency_s"], "saccade_jump", "saccade"),
            "antisaccade": trials_of(stim_raw, lag["latency_s"], "antisaccade_jump", "antisaccade"),
        },
        "words": list(words or []),
        "audio": {"wave": None, "sr": 16000},
        "audio_tasks": dict(audio_tasks or {}),
        "answers": dict(answers or {}),
        "camera": lag,
        "seconds": (frames[-1]["t_ns"] / NS) if frames else 0.0,
        "how": "web",
    }
    sess.update(extra or {})
    return sess
