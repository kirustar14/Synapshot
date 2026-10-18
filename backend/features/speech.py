"""Speech features from the patient audio channel.

faster-whisper gives words with timestamps, parselmouth gives voice quality, librosa
gives the spectral extras. Every one of the three is optional: when a package is missing
the function returns what it can from the transcript it was given and says so in `how`.
Everything is normalized against the patient's own week 0 baseline first, and against
age and sex placeholder norms second.
"""

import numpy as np

VOWELS = "aeiouy"
# Placeholder norms until a real reference sample exists. Flat in age, tiny sex offset.
NORMS = {
    "speech_rate": {"base": 4.6, "per_year": -0.004, "female": 0.05},
    "ptk_rate": {"base": 6.2, "per_year": -0.008, "female": 0.0},
    "ah_duration": {"base": 18.0, "per_year": -0.12, "female": -2.0},
}
_MODEL = None
_TRIED = False


def count_syllables(word: str) -> int:
    """Vowel group count, the usual rough English syllable heuristic."""
    w = "".join(c for c in str(word).lower() if c.isalpha())
    if not w:
        return 0
    groups = 0
    prev = False
    for ch in w:
        now = ch in VOWELS
        if now and not prev:
            groups += 1
        prev = now
    if w.endswith("e") and groups > 1:
        groups -= 1
    return max(1, groups)


def model():
    """Cached faster-whisper model, or None when it is not installed."""
    global _MODEL, _TRIED
    if _TRIED:
        return _MODEL
    _TRIED = True
    try:
        from faster_whisper import WhisperModel

        _MODEL = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    except Exception:
        _MODEL = None
    return _MODEL


def transcribe(wave: np.ndarray | None, sr: int = 16000) -> dict:
    """Words with timestamps from the audio, or an empty list without a backend.

    Local faster-whisper is the default. ASR=elevenlabs sends the audio to the ElevenLabs
    speech to text API instead, with the same signature and the same return shape, so the
    recall, fluency and speech tasks run on either. The local path is preferred because it
    keeps the audio on this machine.
    """
    from ..config import cfg

    if cfg.asr == "elevenlabs":
        got = transcribe_eleven(wave, sr)
        if got["words"] or got["text"]:
            return got

    mod = model()
    if mod is None or wave is None or len(np.asarray(wave)) < sr // 2:
        return {"words": [], "text": "", "how": "none"}
    try:
        segs, _ = mod.transcribe(np.asarray(wave, dtype=np.float32), word_timestamps=True, vad_filter=True)
        words, text = [], []
        for seg in segs:
            text.append(seg.text)
            for w in seg.words or []:
                words.append({"w": w.word.strip(), "t0": float(w.start), "t1": float(w.end)})
        return {"words": words, "text": " ".join(text).strip(), "how": "faster_whisper"}
    except Exception:
        return {"words": [], "text": "", "how": "failed"}


def wav_bytes(wave: np.ndarray, sr: int = 16000) -> bytes:
    """A 16 bit mono wav file in memory, for an API that wants a file upload."""
    import io
    import wave as wavemod

    buf = io.BytesIO()
    with wavemod.open(buf, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(int(sr))
        fh.writeframes((np.clip(np.asarray(wave, dtype=float), -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def transcribe_eleven(wave: np.ndarray | None, sr: int = 16000) -> dict:
    """Words with timestamps from the ElevenLabs speech to text API.

    The model name comes from ELEVENLABS_STT_MODEL and defaults to scribe_v1. Any failure
    returns empty so the caller falls back to the local model.
    """
    import json
    import urllib.error
    import urllib.request
    import uuid

    from ..config import cfg

    if wave is None or len(np.asarray(wave)) < sr // 2 or not cfg.eleven_key:
        return {"words": [], "text": "", "how": "none"}

    bound = f"----unnamed{uuid.uuid4().hex}"
    parts = [
        f"--{bound}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\n"
        f"{cfg.eleven_stt_model}\r\n".encode(),
        f"--{bound}\r\nContent-Disposition: form-data; name=\"file\"; "
        "filename=\"task.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode(),
        wav_bytes(wave, sr),
        f"\r\n--{bound}--\r\n".encode(),
    ]
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text",
        data=b"".join(parts),
        headers={"xi-api-key": cfg.eleven_key,
                 "Content-Type": f"multipart/form-data; boundary={bound}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            got = json.loads(resp.read())
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError):
        return {"words": [], "text": "", "how": "failed"}

    words = []
    for row in got.get("words") or []:
        if str(row.get("type") or "word") != "word":
            continue
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        words.append({"w": text, "t0": float(row.get("start") or 0.0),
                      "t1": float(row.get("end") or 0.0)})
    return {"words": words, "text": str(got.get("text") or "").strip(), "how": "elevenlabs"}


def voiced(wave: np.ndarray, sr: int = 16000, frame_s: float = 0.03, thresh: float = 0.02) -> list[dict]:
    """Voice activity segments by frame energy against a relative threshold."""
    wave = np.asarray(wave, dtype=float)
    step = max(1, int(frame_s * sr))
    if len(wave) < step * 2:
        return []
    rms = np.array([np.sqrt(np.mean(wave[i:i + step] ** 2)) for i in range(0, len(wave) - step, step)])
    hot = rms > max(thresh, 0.25 * float(np.percentile(rms, 95)))
    out, start = [], None
    for i, on in enumerate(hot):
        if on and start is None:
            start = i
        elif not on and start is not None:
            out.append({"t0": start * frame_s, "t1": i * frame_s})
            start = None
    if start is not None:
        out.append({"t0": start * frame_s, "t1": len(hot) * frame_s})
    return [s for s in out if s["t1"] - s["t0"] > 0.08]


def voice_quality(wave: np.ndarray | None, sr: int = 16000) -> dict:
    """Jitter, shimmer, HNR and CPP from parselmouth, or an empty dict without it."""
    if wave is None or len(np.asarray(wave)) < sr // 2:
        return {}
    try:
        import parselmouth
        from parselmouth.praat import call as praat

        snd = parselmouth.Sound(np.asarray(wave, dtype=float), sampling_frequency=sr)
        point = praat(snd, "To PointProcess (periodic, cc)", 75, 500)
        jitter = praat(point, "Get jitter (local)", 0, 0, 1e-4, 0.02, 1.3)
        shimmer = praat([snd, point], "Get shimmer (local)", 0, 0, 1e-4, 0.02, 1.3, 1.6)
        harm = praat(snd, "To Harmonicity (cc)", 0.01, 75, 0.1, 1.0)
        hnr = praat(harm, "Get mean", 0, 0)
        cep = praat(snd, "To PowerCepstrogram", 60, 0.002, 5000, 50)
        cpp = praat(cep, "Get CPPS", "no", 0.01, 0.001, 60, 330, 0.05, "Parabolic", 0.001, 0, "Straight", "Robust")
        return {
            "jitter": float(100.0 * jitter) if np.isfinite(jitter) else 0.0,
            "shimmer": float(100.0 * shimmer) if np.isfinite(shimmer) else 0.0,
            "hnr": float(hnr) if np.isfinite(hnr) else 0.0,
            "cpp": float(cpp) if np.isfinite(cpp) else 0.0,
        }
    except Exception:
        return {}


def spectral(wave: np.ndarray | None, sr: int = 16000) -> dict:
    """Spectral extras from librosa, or an empty dict without it."""
    if wave is None or len(np.asarray(wave)) < sr // 2:
        return {}
    try:
        import librosa

        y = np.asarray(wave, dtype=float)
        return {
            "centroid": float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))),
            "flatness": float(np.mean(librosa.feature.spectral_flatness(y=y))),
            "zcr": float(np.mean(librosa.feature.zero_crossing_rate(y=y))),
        }
    except Exception:
        return {}


def ah_duration(wave: np.ndarray | None, sr: int = 16000) -> float:
    """Longest continuous voiced stretch in seconds, the sustained ah task."""
    segs = voiced(wave if wave is not None else np.zeros(0), sr)
    return float(max((s["t1"] - s["t0"] for s in segs), default=0.0))


def ptk_rate(wave: np.ndarray | None, sr: int = 16000, dur_s: float | None = None) -> float:
    """Pa-ta-ka syllables per second from energy envelope peaks."""
    if wave is None:
        return 0.0
    from scipy.signal import find_peaks

    y = np.asarray(wave, dtype=float)
    if len(y) < sr // 2:
        return 0.0
    step = max(1, int(0.005 * sr))
    env = np.array([np.sqrt(np.mean(y[i:i + step] ** 2)) for i in range(0, len(y) - step, step)])
    if env.max() <= 0:
        return 0.0
    peaks, _ = find_peaks(env / env.max(), height=0.25, distance=int(0.06 / 0.005))
    span = dur_s or (len(y) / sr)
    return float(len(peaks) / span) if span > 0 else 0.0


def passage_rate(words: list[dict]) -> float:
    """Syllables per second over the read passage."""
    if len(words) < 3:
        return 0.0
    span = float(words[-1]["t1"] - words[0]["t0"])
    syl = sum(count_syllables(w["w"]) for w in words)
    return float(syl / span) if span > 0.2 else 0.0


def rapid_naming(words: list[dict], cards: int = 4) -> dict:
    """Seconds per card for rapid number naming, split evenly across the word stream."""
    if len(words) < cards * 2:
        return {"rapid_naming": None, "per_card": []}
    chunk = len(words) // cards
    per = []
    for c in range(cards):
        part = words[c * chunk:(c + 1) * chunk]
        if len(part) > 1:
            per.append(float(part[-1]["t1"] - part[0]["t0"]))
    return {"rapid_naming": float(np.mean(per)) if per else None, "per_card": [round(v, 2) for v in per]}


def norm_z(key: str, value: float, age: int, sex: str) -> float:
    """Placeholder age and sex norm, as a signed difference from the expected value.

    expected = base + per_year*(age - 30) + female*[sex == F]
    """
    spec = NORMS.get(key)
    if not spec or value is None:
        return 0.0
    exp = spec["base"] + spec["per_year"] * (int(age) - 30) + (spec["female"] if sex == "F" else 0.0)
    return float(value - exp)


def normalize(values: dict, baseline: dict | None, age: int, sex: str) -> dict:
    """Add own baseline deltas and norm differences next to the raw values."""
    out = {}
    for key, val in values.items():
        if val is None:
            continue
        out[key] = val
        if baseline and key in baseline and baseline[key] is not None:
            out[f"{key}_vs_own"] = float(val - baseline[key])
        if key in NORMS:
            out[f"{key}_vs_norm"] = norm_z(key, float(val), age, sex)
    return out


def measure(session: dict, age: int = 30, sex: str = "M", baseline: dict | None = None) -> dict:
    """Every speech feature available from one session."""
    audio = session.get("audio") or {}
    wave = audio.get("wave")
    sr = int(audio.get("sr", 16000))
    words = session.get("words") or []
    how = "given"
    if not words:
        got = transcribe(wave, sr)
        words, how = got["words"], got["how"]

    tasks = session.get("audio_tasks") or {}
    vals = {
        "speech_rate": passage_rate([w for w in words if w.get("task", "passage") == "passage"] or words),
        "ah_duration": ah_duration(tasks.get("ah"), sr) or session.get("ah_duration"),
        "ptk_rate": ptk_rate(tasks.get("ptk"), sr, dur_s=session.get("ptk_seconds")) or session.get("ptk_rate"),
    }
    vals.update(voice_quality(wave, sr))
    vals.update(spectral(wave, sr))
    vals.update(rapid_naming([w for w in words if w.get("task") == "numbers"] or words))
    vals = {k: v for k, v in vals.items() if v is not None}
    out = normalize(vals, baseline, age, sex)
    out["how"] = how
    out["words"] = len(words)
    return out
