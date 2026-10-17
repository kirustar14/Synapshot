"""Audio in and out of FaceTime through virtual devices.

Out: the agent's voice is synthesized with the macOS `say` binary and played into
BlackHole 2ch, which FaceTime is using as its microphone, so the patient hears it.
In: FaceTime's output goes to a second virtual device, which is recorded here and handed
to the speech pipeline. Device names come from config.
"""

import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000
VOICE = "Samantha"


def devices() -> list[dict]:
    """Every audio device sounddevice can see, or an empty list without it."""
    try:
        import sounddevice as sd

        return [dict(d) for d in sd.query_devices()]
    except Exception:
        return []


def find(name: str, kind: str = "output") -> int | None:
    """Index of the first device whose name contains `name` and has the right channels."""
    want = "max_output_channels" if kind == "output" else "max_input_channels"
    for i, dev in enumerate(devices()):
        if name.lower() in str(dev.get("name", "")).lower() and int(dev.get(want, 0)) > 0:
            return i
    return None


def tts(text: str, path: Path | None = None) -> Path | None:
    """Render speech to a 16 kHz mono wav with `say`, or None when it is not there."""
    if not shutil.which("say"):
        return None
    out = Path(path or Path(tempfile.mkdtemp()) / "say.wav")
    cmd = ["say", "-v", VOICE, "-o", str(out), "--data-format=LEI16@16000", text]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=30)
    except Exception:
        return None
    return out if out.exists() else None


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 samples and the sample rate from a wav file."""
    with wave.open(str(path), "rb") as fh:
        sr = fh.getframerate()
        raw = fh.readframes(fh.getnframes())
        chan = fh.getnchannels()
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if chan > 1:
        data = data.reshape(-1, chan).mean(axis=1)
    return data, sr


def play(wave_data: np.ndarray, sr: int, device: str | None = None) -> bool:
    """Play samples into the virtual mic FaceTime is listening to."""
    from backend.config import cfg

    try:
        import sounddevice as sd

        idx = find(device or cfg.mic_device, "output")
        sd.play(np.asarray(wave_data, dtype=np.float32), sr, device=idx, blocking=True)
        return True
    except Exception:
        return False


def speak(text: str, device: str | None = None) -> bool:
    """Say one line into FaceTime. Returns False when the audio path is not available."""
    path = tts(text)
    if path is None:
        return False
    data, sr = read_wav(path)
    return play(data, sr, device)


def record(seconds: float, device: str | None = None) -> np.ndarray:
    """Record the patient channel for a fixed time, mono float32 at 16 kHz."""
    from backend.config import cfg

    try:
        import sounddevice as sd

        idx = find(device or cfg.spk_device, "input")
        got = sd.rec(int(seconds * SR), samplerate=SR, channels=1, device=idx, dtype="float32")
        sd.wait()
        return np.asarray(got, dtype=np.float32).ravel()
    except Exception:
        return np.zeros(0, dtype=np.float32)


def energy(wave_data: np.ndarray) -> float:
    """Root mean square of a buffer, used to tell when the call was answered."""
    arr = np.asarray(wave_data, dtype=float)
    return float(np.sqrt(np.mean(arr**2))) if arr.size else 0.0


def wait_for_voice(seconds: float = 30.0, thresh: float = 0.01, window: float = 2.0) -> bool:
    """Listen until there is voice energy for a whole window, or time out."""
    import time

    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if energy(record(window)) > thresh:
            return True
    return False


def transcribe(wave_data: np.ndarray) -> str:
    """Words from a recording, through the speech pipeline."""
    from backend.features import speech

    got = speech.transcribe(wave_data, SR)
    if got["text"]:
        return got["text"]
    return " ".join(w["w"] for w in got["words"])


def check() -> dict:
    """Preflight: are both virtual devices present and is `say` installed."""
    from backend.config import cfg

    mic = find(cfg.mic_device, "output")
    spk = find(cfg.spk_device, "input")
    return {
        "mic_device": cfg.mic_device,
        "mic_found": mic is not None,
        "spk_device": cfg.spk_device,
        "spk_found": spk is not None,
        "say": bool(shutil.which("say")),
        "devices": len(devices()),
    }
