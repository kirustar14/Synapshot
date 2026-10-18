"""Pre-generate every spoken line as an mp3 with ElevenLabs. Run with `make voices`.

Every line the patient hears is generated ahead of the call and served as a static file,
so a slow API can never stall a task with a patient sitting there waiting. The browser's
own speech synthesis is the fallback for any line without a file.

The banned phrase filter runs BEFORE generation, and a line that fails it is refused
rather than quietly replaced, because a refusal is visible in the manifest and a silent
substitution is not.

Nothing here is on the safety path: the red flag decision is made by the backend from the
answers, and the emergency wording is a fixed string. The audio is only how it is read out.
"""

import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

from ..calls import script as webscript
from ..config import cfg
from . import safety

API = "https://api.elevenlabs.io/v1/text-to-speech"
TIMEOUT_S = 60
# Calm and slow. stability high so it does not get expressive, speed below 1 because the
# patient may have a headache and is being given instructions.
SETTINGS = {"stability": 0.65, "similarity_boost": 0.75, "style": 0.0,
            "use_speaker_boost": True, "speed": 0.92}


# Preference order when the configured voice cannot be used. Calm, clear, unhurried, and
# all premade rather than library voices, because a free account cannot use a library
# voice through the API.
PREFER = ["Sarah", "Alice", "River", "Matilda", "George", "Will"]
_VOICE: str | None = None


def voices_on_account() -> list[dict]:
    """Every voice this key can actually use, newest API shape, or an empty list."""
    if not cfg.eleven_key:
        return []
    req = urllib.request.Request(f"{API.rsplit('/', 1)[0]}/voices",
                                 headers={"xi-api-key": cfg.eleven_key})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            got = json.loads(resp.read())
    except Exception:
        return []
    return [v for v in got.get("voices", []) if v.get("voice_id")]


def resolve_voice() -> str:
    """The voice id to generate with.

    The configured one when the account has it, otherwise the best available premade
    voice. A library voice on a free plan returns 402, so falling back to a premade one
    is the difference between having audio and having none. Whatever is chosen is
    recorded in the manifest and printed, so it is never a silent swap.
    """
    global _VOICE
    if _VOICE is not None:
        return _VOICE
    have = voices_on_account()
    ids = {v["voice_id"] for v in have}
    if cfg.eleven_voice and cfg.eleven_voice in ids:
        _VOICE = cfg.eleven_voice
        return _VOICE
    usable = [v for v in have if v.get("category") != "library"]
    for want in PREFER:
        for v in usable:
            if str(v.get("name", "")).startswith(want):
                _VOICE = v["voice_id"]
                return _VOICE
    if usable:
        _VOICE = usable[0]["voice_id"]
        return _VOICE
    _VOICE = cfg.eleven_voice
    return _VOICE


def voice_name(voice_id: str) -> str:
    """The display name of a voice id, for the printout."""
    for v in voices_on_account():
        if v.get("voice_id") == voice_id:
            return str(v.get("name") or voice_id)
    return voice_id


def voice_dir() -> Path:
    """Where the mp3s live."""
    out = cfg.data_dir / "voice"
    out.mkdir(parents=True, exist_ok=True)
    return out


def manifest_path() -> Path:
    """Where the line text, hash and duration are recorded."""
    return voice_dir() / "manifest.json"


def live() -> bool:
    """True when a real ElevenLabs key and voice are configured."""
    return bool(not cfg.mock_eleven and cfg.eleven_key and cfg.eleven_voice)


def hash_of(text: str) -> str:
    """Stable hash of the line plus the voice and model it would be generated with.

    The voice id and the model are in the hash so changing either regenerates, rather
    than leaving a file that no longer matches what the config asks for. The configured
    voice is used here rather than the resolved one so the hash does not depend on a
    network call.
    """
    raw = f"{cfg.eleven_voice}|{cfg.eleven_tts_model}|{text}".encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def manifest() -> dict:
    """The manifest as stored, or an empty one."""
    path = manifest_path()
    if not path.exists():
        return {"model": cfg.eleven_tts_model, "voice": "", "lines": {}}
    try:
        return json.loads(path.read_text())
    except ValueError:
        return {"model": cfg.eleven_tts_model, "voice": "", "lines": {}}


def save_manifest(got: dict) -> None:
    """Write the manifest."""
    manifest_path().write_text(json.dumps(got, indent=2, sort_keys=True))


def duration_of(path: Path) -> float | None:
    """Length of an mp3 in seconds via ffmpeg, or None when it cannot be read."""
    import shutil
    import subprocess

    if not shutil.which("ffprobe"):
        return None
    try:
        got = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=20, check=False)
        return round(float(got.stdout.strip()), 2)
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def generate(text: str, out: Path) -> dict:
    """Generate one mp3. Refuses a line that fails the banned phrase filter."""
    bad = safety.violations(text)
    if bad:
        return {"ok": False, "error": f"refused, the line contains {bad}"}
    if not live():
        return {"ok": False, "error": "no ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID"}

    voice = resolve_voice()
    if not voice:
        return {"ok": False, "error": "no usable voice on this ElevenLabs account"}
    body = json.dumps({
        "text": text,
        "model_id": cfg.eleven_tts_model,
        "voice_settings": SETTINGS,
    }).encode()
    req = urllib.request.Request(
        f"{API}/{voice}",
        data=body,
        headers={"xi-api-key": cfg.eleven_key, "Content-Type": "application/json",
                 "Accept": "audio/mpeg"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as exc:
        # The body can carry a useful reason. The key is never in it and never printed.
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:200]
        except Exception:
            detail = ""
        return {"ok": False, "error": f"HTTP {exc.code} {detail}"}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"ok": False, "error": str(exc)[:200]}

    if len(audio) < 500:
        return {"ok": False, "error": "the API returned almost no audio"}
    out.write_bytes(audio)
    return {"ok": True, "bytes": len(audio)}


def lines() -> list[dict]:
    """Every line that needs an mp3, with the id its file is named after."""
    return webscript.voice_lines()


def build(force: bool = False, only: str = "") -> dict:
    """Generate every line whose hash changed. Returns what happened per line."""
    man = manifest()
    was = man.get("lines", {})
    out: dict = {}
    made = 0
    kept = 0
    failed = 0

    for row in lines():
        sid, text = row["id"], row["text"]
        if only and sid != only:
            if sid in was:
                out[sid] = was[sid]
            continue
        want = hash_of(text)
        path = voice_dir() / f"{sid}.mp3"
        have = was.get(sid, {})
        if not force and have.get("hash") == want and path.exists():
            out[sid] = have
            kept += 1
            continue

        got = generate(text, path)
        if got["ok"]:
            out[sid] = {"text": text, "hash": want, "file": path.name,
                        "duration_s": duration_of(path), "bytes": got["bytes"]}
            made += 1
        else:
            out[sid] = {"text": text, "hash": want, "file": None,
                        "duration_s": None, "error": got["error"]}
            failed += 1

    used = resolve_voice() if live() else ""
    save_manifest({"model": cfg.eleven_tts_model, "voice_id": used,
                   "configured_voice": cfg.eleven_voice, "live": live(), "lines": out})
    return {"made": made, "kept": kept, "failed": failed, "total": len(lines()),
            "live": live(), "voice_id": used, "lines": out}


def audio_map() -> dict:
    """Step id to file name, for the lines that actually have an mp3 on disk."""
    out = {}
    for sid, row in manifest().get("lines", {}).items():
        name = row.get("file")
        if name and (voice_dir() / name).exists():
            out[sid] = name
    return out


def payload() -> dict:
    """The Voices contract object for the demo console panel."""
    man = manifest()
    have = man.get("lines", {})
    rows = []
    for row in lines():
        sid = row["id"]
        got = have.get(sid, {})
        name = got.get("file")
        exists = bool(name and (voice_dir() / name).exists())
        rows.append({
            "id": sid,
            "text": row["text"],
            "hash": hash_of(row["text"]),
            "file": f"/voice/{name}" if exists else "",
            "exists": exists,
            "duration_s": got.get("duration_s"),
            "stale": bool(got.get("hash") and got["hash"] != hash_of(row["text"])),
            "error": got.get("error"),
        })
    return {
        "base": "/voice/",
        "live": live(),
        "model": cfg.eleven_tts_model,
        "lines": rows,
        "note": "Lines without an mp3 fall back to the browser's own speech synthesis.",
    }


def main() -> int:
    """Generate the voices and print what happened. Run with `make voices`."""
    got = build()
    print("")
    print(f"  voices   {'ElevenLabs ' + cfg.eleven_tts_model if got['live'] else 'no key, nothing generated'}")
    if got["live"]:
        used = got.get("voice_id") or ""
        if used and used != cfg.eleven_voice:
            print(f"  voice    {voice_name(used)}")
            print(f"           ELEVENLABS_VOICE_ID is not on this account, so this one was")
            print(f"           used instead. Put it in .env to make the choice explicit:")
            print(f"           ELEVENLABS_VOICE_ID={used}")
        elif used:
            print(f"  voice    {voice_name(used)}")
    print(f"  lines    {got['total']} total, {got['made']} generated, {got['kept']} unchanged, "
          f"{got['failed']} without audio")
    if got["failed"]:
        print("")
        print("  Without audio, these fall back to the browser's speech synthesis:")
        for sid, row in got["lines"].items():
            if row.get("error"):
                print(f"    {sid:28s} {row['error']}")
    print("")
    print(f"  written  {voice_dir()}")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
