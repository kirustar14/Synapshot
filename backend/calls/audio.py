"""Decode the audio the browser uploads into 16 kHz mono wav with ffmpeg.

Safari records mp4 with aac, Chrome and Firefox record webm with opus or ogg, and none of
those go straight into the speech features. ffmpeg handles all of them, so it is a hard
requirement rather than an optional extra, and the error says so plainly instead of
silently dropping every speech measure.
"""

import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

from ..config import cfg

SR = 16000
MAX_BYTES = 40 * 1024 * 1024    # about ten minutes of opus, far more than any one task
TIMEOUT_S = 120

# The tasks that upload audio, and how long each is allowed to be.
TASKS = {
    "speech_ah": 40.0,
    "speech_pataka": 30.0,
    "speech_passage": 90.0,
    "picture": 120.0,
    "fluency": 90.0,
    "recall": 90.0,
    "npc": 30.0,
    "encode": 120.0,
}


def have_ffmpeg() -> bool:
    """Whether ffmpeg is on the path."""
    return shutil.which("ffmpeg") is not None


def dir_for(token: str) -> Path:
    """Where one session's audio lives while the features are being taken out of it."""
    out = cfg.data_dir / "calls" / token
    out.mkdir(parents=True, exist_ok=True)
    return out


def save(token: str, task: str, data: bytes, suffix: str = "") -> Path:
    """Write the uploaded bytes next to the session, unconverted."""
    if len(data) > MAX_BYTES:
        raise ValueError(f"audio for {task} is larger than {MAX_BYTES // (1024 * 1024)} MB")
    out = dir_for(token) / f"{task}{suffix or '.bin'}"
    out.write_bytes(data)
    return out


def to_wav(src: Path) -> Path:
    """Convert anything ffmpeg understands to 16 kHz mono 16 bit wav."""
    if not have_ffmpeg():
        raise RuntimeError(
            "ffmpeg is not installed, so uploaded audio cannot be decoded and every "
            "speech measure would be missing. Install it with: brew install ffmpeg"
        )
    out = src.with_suffix(".wav")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", str(out)]
    got = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT_S, check=False)
    if got.returncode != 0 or not out.exists():
        detail = got.stderr.decode("utf-8", "replace").strip()[:300]
        raise RuntimeError(f"ffmpeg could not decode {src.name}: {detail}")
    return out


def read_wav(path: Path) -> np.ndarray:
    """A mono float array in minus 1 to 1 from a 16 bit wav."""
    with wave.open(str(path), "rb") as fh:
        raw = fh.readframes(fh.getnframes())
        width = fh.getsampwidth()
    if width != 2:
        raise ValueError(f"expected 16 bit wav, got {width * 8} bit")
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def ingest(token: str, task: str, data: bytes, content_type: str = "") -> dict:
    """Save, decode and load one uploaded task recording."""
    suffix = suffix_for(content_type)
    src = save(token, task, data, suffix)
    wav = to_wav(src)
    arr = read_wav(wav)
    limit = TASKS.get(task, 120.0)
    seconds = len(arr) / SR
    if seconds > limit * 1.5:
        arr = arr[: int(limit * 1.5 * SR)]
    return {"task": task, "wav": str(wav), "seconds": round(seconds, 2),
            "samples": len(arr), "sr": SR}


def suffix_for(content_type: str) -> str:
    """A sensible file extension for what the browser said it was sending."""
    low = (content_type or "").lower()
    for needle, ext in (("mp4", ".mp4"), ("m4a", ".m4a"), ("aac", ".aac"),
                        ("webm", ".webm"), ("ogg", ".ogg"), ("wav", ".wav"),
                        ("mpeg", ".mp3"), ("caf", ".caf")):
        if needle in low:
            return ext
    return ".bin"


def waves(token: str) -> dict:
    """Every decoded wav for a session, keyed by the task name the pipeline expects."""
    out = {}
    base = dir_for(token)
    # The pipeline knows these three by their short rig names.
    alias = {"speech_ah": "ah", "speech_pataka": "ptk", "speech_passage": "passage"}
    for path in sorted(base.glob("*.wav")):
        task = path.stem
        try:
            out[alias.get(task, task)] = read_wav(path)
        except Exception:
            continue
    return out


def discard(token: str) -> int:
    """Delete a session's audio once the features are out of it.

    Kept only when KEEP_AUDIO=1, which is for debugging a bad recording and nothing else.
    """
    if cfg.keep_audio:
        return 0
    base = cfg.data_dir / "calls" / token
    if not base.exists():
        return 0
    gone = 0
    for path in base.iterdir():
        try:
            path.unlink()
            gone += 1
        except OSError:
            continue
    try:
        base.rmdir()
    except OSError:
        pass
    return gone
