"""Is the phone demo ready? Run with `make phone`.

`make check` covers the whole system. This covers one question: can a text reach your
phone and can your phone open the call page. Every line that is not ready says exactly
what to do about it, in the order you should do it.
"""

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request

from .config import ROOT, cfg

OK = "ready"
NO = "TODO"
MEH = "note"


def row(state: str, what: str, detail: str = "") -> dict:
    """One line of the checklist."""
    return {"state": state, "what": what, "detail": detail}


def mask(number: str) -> str:
    """A number with the middle hidden, so logs and screen shares stay clean."""
    return f"{number[:3]}...{number[-4:]}" if number and len(number) > 7 else (number or "not set")


def tunnel_live() -> tuple[bool, str]:
    """Whether PUBLIC_URL answers over https right now."""
    if not cfg.public_url:
        return False, "PUBLIC_URL is not set"
    if not cfg.public_url.startswith("https://"):
        return False, "PUBLIC_URL is not https, and iOS will not open the camera without it"
    try:
        with urllib.request.urlopen(f"{cfg.public_url}/api/health", timeout=10) as resp:
            return resp.status < 400, ""
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, str(exc)[:70]


def run() -> list[dict]:
    """The checklist, in the order the steps have to happen."""
    out = []
    numbers = cfg.demo_phones

    # 1. Who may be contacted at all.
    if not numbers:
        out.append(row(NO, "1. Put your number in DEMO_PHONES",
                       "in .env. Nothing can be sent anywhere until it is there."))
    else:
        out.append(row(OK, f"1. DEMO_PHONES holds {', '.join(mask(n) for n in numbers)}",
                       "the only numbers anything is allowed to contact"))

    # 2 and 3. Whether iMessage can actually send, which is two separate questions:
    # does the hosted project own a line, and will this Mac let us read Messages. The
    # probe answers both and says what to click.
    from .comms import photon

    docs = photon.docs()
    if not docs.get("installed"):
        out.append(row(NO, "2. Install the iMessage packages", "run: make imessage"))
    else:
        out.append(row(OK, "2. The iMessage packages are installed",
                       "cloud and local transports are both available to try"))
    out.append(row(MEH, "3. Check which iMessage path can send",
                   "run: make send-test. It says, per path, whether it sent and what to "
                   "fix if not."))

    # 4. A tunnel, so the phone can reach this laptop over https. This is the one
    # that matters most: with it, a QR code in the call modal works even when no
    # message can be sent at all.
    tool = next((t for t in ("cloudflared", "ngrok") if shutil.which(t)), "")
    if not tool:
        out.append(row(NO, "4. Install a tunnel tool", "brew install cloudflared"))
    else:
        live, why = tunnel_live()
        if live:
            out.append(row(OK, f"4. PUBLIC_URL answers: {cfg.public_url}",
                           "your phone can reach this machine"))
        else:
            out.append(row(NO, "4. Start the tunnel and set PUBLIC_URL",
                           f"run: {tool} tunnel --url http://localhost:8000   then put the "
                           f"https URL it prints into PUBLIC_URL in .env and restart make dev. "
                           f"({why})"))

    # 5. Are the credentials even there. Whether they can send is step 3's job.
    from .comms import notify as texter

    got = texter.status()
    if got.get("imessage"):
        out.append(row(OK, "5. iMessage credentials are set",
                       "a message is only ever labelled iMessage when a real transport "
                       "reported success, and only delivered when the provider confirmed "
                       "it. There is no SMS fallback: a failed iMessage stays failed so "
                       "the screen can say so."))
    else:
        out.append(row(MEH, "5. iMessage is mocked",
                       "messages go to the patient's thread and nothing is sent. Set "
                       "PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET to try for real."))

    # 6. What the phone has to download to measure anything.
    model = ROOT / "web" / "public" / "models" / "face_landmarker.task"
    if model.exists():
        out.append(row(OK, "6. The face model is in place",
                       f"{model.stat().st_size // (1024 * 1024)} MB, your phone downloads it once"))
    else:
        out.append(row(NO, "6. Download the face model", "run: make models"))

    dist = ROOT / "web" / "dist" / "index.html"
    out.append(row(OK, "7. The app is built", "served at /") if dist.exists()
               else row(NO, "7. Build the app", "run: make web"))

    # 8. Is the server even up.
    try:
        with urllib.request.urlopen(f"{cfg.api_base}/api/health", timeout=4) as resp:
            up = resp.status < 400
    except Exception:
        up = False
    out.append(row(OK, "8. The server is running", cfg.api_base) if up
               else row(NO, "8. Start the server", "run: make dev, in its own terminal"))

    return out


def main() -> int:
    """Print the checklist. Always returns 0: this reports, it does not gate anything."""
    got = run()
    todo = [r for r in got if r["state"] == NO]
    print("")
    print("  Can the demo reach your phone?")
    print("  " + "=" * 74)
    print("")
    for r in got:
        print(f"  [{r['state']:5s}] {r['what']}")
        if r["detail"]:
            words, line = r["detail"].split(), "         "
            for w in words:
                if len(line) + len(w) > 78:
                    print(line)
                    line = "         "
                line += w + " "
            print(line.rstrip())
        print("")
    print("  " + "=" * 74)
    if todo:
        print(f"  {len(todo)} thing(s) left. Do them in the order above.")
    else:
        print("  All set. Open a patient and press Call patient.")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
