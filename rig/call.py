"""Place the FaceTime call, with a manual fallback when accessibility scripting fails."""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("place_call.scpt")
TIMEOUT_S = 30.0


def place(number: str) -> dict:
    """Run the AppleScript. Returns how it went and whether a human has to press Call."""
    if not number:
        return {"ok": False, "how": "none", "detail": "no number configured", "manual": True}
    if not SCRIPT.exists():
        return {"ok": False, "how": "none", "detail": "place_call.scpt is missing", "manual": True}
    try:
        got = subprocess.run(
            ["osascript", str(SCRIPT), number],
            capture_output=True, text=True, timeout=TIMEOUT_S,
        )
    except Exception as exc:
        return {"ok": False, "how": "osascript", "detail": str(exc), "manual": True}
    out = (got.stdout or got.stderr or "").strip()
    if got.returncode != 0 or out.startswith("error:"):
        return {"ok": False, "how": "osascript", "detail": out, "manual": True}
    return {"ok": True, "how": "osascript", "detail": out, "manual": out.startswith("manual:")}


def manual_prompt(number: str) -> None:
    """Ask the operator to press Call, because accessibility scripting did not."""
    print("")
    print(f"  FaceTime should be open with {number} staged.")
    print("  Click Call, wait for the patient to answer, then press Enter here.")
    try:
        input("  > ")
    except EOFError:
        pass


def hang_up() -> dict:
    """End the call. Cmd-W on the FaceTime window, which is what ends a FaceTime call."""
    script = (
        'tell application "System Events" to tell process "FaceTime" '
        'to keystroke "w" using command down'
    )
    try:
        got = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        return {"ok": got.returncode == 0, "detail": (got.stderr or "").strip()}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


def check() -> dict:
    """Preflight: is osascript there and is the script in place."""
    import shutil

    return {"osascript": bool(shutil.which("osascript")), "script": SCRIPT.exists()}


if __name__ == "__main__":
    print(place(sys.argv[1] if len(sys.argv) > 1 else ""))
