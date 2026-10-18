"""Green or red checks before a call. Prints them and serves GET /api/rig/preflight."""

import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import cfg  # noqa: E402


def check(name: str, ok: bool, detail: str) -> dict:
    """One Check in the contract shape."""
    return {"name": name, "ok": bool(ok), "detail": str(detail)}


def obs_camera() -> dict:
    """Is the OBS virtual camera present for FaceTime to use."""
    from rig import audio

    names = [str(d.get("name", "")) for d in audio.devices()]
    hit = any("obs" in n.lower() for n in names)
    if hit:
        return check("OBS virtual camera", True, "OBS device present")
    try:
        got = subprocess.run(["system_profiler", "SPCameraDataType"], capture_output=True,
                             text=True, timeout=15).stdout.lower()
        if "obs" in got:
            return check("OBS virtual camera", True, "found in system cameras")
        cams = [ln.strip().rstrip(":") for ln in got.splitlines() if ln.strip().endswith(":") and "camera" not in ln.lower()]
        return check("OBS virtual camera", False,
                     "not found. Start OBS, add a Browser Source for the stimulus page, then "
                     f"Start Virtual Camera. Cameras seen: {', '.join(cams[:4]) or 'none'}")
    except Exception as exc:
        return check("OBS virtual camera", False, f"could not list cameras: {exc}")


def blackhole() -> list[dict]:
    """Are both virtual audio devices there."""
    from rig import audio

    got = audio.check()
    return [
        check(f"Audio out to FaceTime ({got['mic_device']})", got["mic_found"],
              "present" if got["mic_found"] else "install BlackHole 2ch and set it as the FaceTime microphone"),
        check(f"Audio in from FaceTime ({got['spk_device']})", got["spk_found"],
              "present" if got["spk_found"] else "add a second virtual device and send FaceTime output to it"),
        check("Text to speech", got["say"], "macOS say is available" if got["say"] else "the say binary is missing"),
    ]


def permissions() -> list[dict]:
    """Accessibility and Screen Recording, both needed and both silent when missing."""
    out = []
    try:
        got = subprocess.run(
            ["osascript", "-e", 'tell application "System Events" to count processes'],
            capture_output=True, text=True, timeout=10,
        )
        ok = got.returncode == 0
        out.append(check("Accessibility permission", ok,
                         "System Events is scriptable" if ok else
                         "grant Accessibility to Terminal or Python in System Settings, Privacy and Security"))
    except subprocess.TimeoutExpired:
        out.append(check("Accessibility permission", False,
                         "timed out. macOS is probably showing the permission dialog right now, "
                         "accept it and run preflight again"))
    except Exception as exc:
        out.append(check("Accessibility permission", False, str(exc)))

    from rig import capture

    cap = capture.check()
    if not cap["mss"]:
        out.append(check("Screen Recording permission", False, "mss is not installed"))
    else:
        try:
            import numpy as np

            sct = capture.grabber()
            shot = np.asarray(sct.grab(capture.full_screen()))
            blank = float(shot[:, :, :3].std()) < 1.0
            out.append(check("Screen Recording permission", not blank,
                             "screen capture returns real pixels" if not blank else
                             "capture is blank, grant Screen Recording in System Settings"))
        except Exception as exc:
            out.append(check("Screen Recording permission", False, str(exc)))
    return out


def facetime_window() -> dict:
    """Is the FaceTime window up and big enough to capture."""
    from rig import capture

    region = capture.window_region()
    if region:
        return check("FaceTime window", True,
                     f"{region['width']}x{region['height']} at {region['left']},{region['top']}")
    return check("FaceTime window", False, "not found, open FaceTime and start the call first")


def mediapipe_loads() -> dict:
    """Does the face landmarker build."""
    from backend.features import face

    if face.available():
        return check("MediaPipe Face Landmarker", True, "loaded with iris and blendshapes")
    try:
        import mediapipe  # noqa: F401

        return check("MediaPipe Face Landmarker", False,
                     "mediapipe is installed but the model file is missing. Set OFFLINE=0 once to fetch it")
    except Exception:
        return check("MediaPipe Face Landmarker", False, "mediapipe is not installed, eye tasks will be skipped")


def whisper_loads() -> dict:
    """Does the speech model build."""
    from backend.features import speech

    if speech.model() is not None:
        return check("Whisper", True, "faster-whisper tiny.en loaded")
    return check("Whisper", False, "faster-whisper is not installed, speech runs from the scripted transcript")


def stimulus_page() -> dict:
    """Is the stimulus page reachable and is the backend up."""
    import urllib.request

    url = cfg.api_base.rstrip("/") + "/stimulus/"
    try:
        with urllib.request.urlopen(url, timeout=4) as resp:
            body = resp.read(400).decode(errors="ignore")
        ok = resp.status < 400 and "Synapshot stimulus" in body
        return check("Stimulus page", ok, url if ok else f"{url} responded {resp.status}")
    except Exception as exc:
        return check("Stimulus page", False, f"{url} not reachable: {exc}. Start the backend with make dev")


def flash_test() -> dict:
    """Does the flash detector find a step in a synthetic series. Runs offline."""
    from backend.features import flash

    hits = 0
    for i in range(10):
        t, lum = flash.synth(t_f=1.0, delay_s=0.2 + 0.01 * i, seed=i)
        hits += bool(flash.detect(t, lum, 1.0)["found"])
    return check("Flash detector", hits >= flash.NEED, f"{hits} of 10 synthetic flashes found")


def clock_stamping() -> dict:
    """Is the monotonic clock actually monotonic and fine grained."""
    a = time.monotonic_ns()
    time.sleep(0.01)
    b = time.monotonic_ns()
    delta = (b - a) / 1e6
    return check("Monotonic clock", b > a and delta < 100,
                 f"10 ms sleep measured {delta:.2f} ms")


def websocket_port() -> dict:
    """Is the backend port open."""
    host = "127.0.0.1"
    port = int(cfg.api_base.rsplit(":", 1)[-1]) if ":" in cfg.api_base else 8000
    sock = socket.socket()
    sock.settimeout(2.0)
    try:
        sock.connect((host, port))
        return check("Backend port", True, f"{host}:{port} is open")
    except Exception:
        return check("Backend port", False, f"nothing listening on {host}:{port}, run make dev")
    finally:
        sock.close()


def notes() -> list[dict]:
    """Two things that cannot be checked in code but ruin calls when forgotten."""
    return [
        check("Do Not Disturb", True,
              "turn on Do Not Disturb before the call. A notification sound lands in the "
              "patient's audio and a banner lands in the captured video"),
        check("Network", True,
              "if Wi-Fi stutters, tether the Mac to the phone hotspot. A dropped frame is a "
              "dropped measurement, and the flash test is the first thing to fail"),
    ]


def run() -> list[dict]:
    """Every check, in the order a person would fix them."""
    out = [websocket_port(), stimulus_page(), obs_camera()]
    out += blackhole()
    out += permissions()
    out += [facetime_window(), mediapipe_loads(), whisper_loads(), flash_test(), clock_stamping()]
    out += notes()
    return out


def main() -> int:
    """Print the checks. Returns 1 when anything that blocks a call is red."""
    checks = run()
    print("")
    print("  Synapshot rig preflight")
    print("  " + "-" * 62)
    for c in checks:
        mark = "GREEN" if c["ok"] else " RED "
        print(f"  [{mark}] {c['name']}")
        print(f"          {c['detail']}")
    bad = [c for c in checks if not c["ok"]]
    print("  " + "-" * 62)
    if bad:
        print(f"  {len(bad)} of {len(checks)} checks are red.")
        print("  The call can still run in mock mode: MOCK_RIG=1 python rig/run_call.py")
    else:
        print(f"  all {len(checks)} checks green, the rig is ready")
    print("")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
