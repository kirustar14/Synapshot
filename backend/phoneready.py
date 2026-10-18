"""Is the phone demo ready? Run with `make phone`.

`make check` covers the whole system. This covers one question: can a text reach your
phone and can your phone open the call page. Every line that is not ready says exactly
what to do about it, in the order you should do it.
"""

import base64
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


def twilio_verified() -> tuple[list[str], str]:
    """Numbers this Twilio account may contact, and an error if we could not ask."""
    if not (cfg.twilio_sid and cfg.twilio_token):
        return [], "no Twilio credentials"
    auth = base64.b64encode(f"{cfg.twilio_sid}:{cfg.twilio_token}".encode()).decode()
    url = (f"https://api.twilio.com/2010-04-01/Accounts/{cfg.twilio_sid}"
           "/OutgoingCallerIds.json")
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            got = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return [], f"Twilio said HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return [], str(exc)[:80]
    return [r.get("phone_number", "") for r in got.get("outgoing_caller_ids", [])], ""


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
    verified, verr = twilio_verified()
    numbers = cfg.demo_phones

    # 1. Who may be contacted at all.
    if not numbers:
        out.append(row(NO, "1. Put your number in DEMO_PHONES",
                       "in .env. Nothing can be sent anywhere until it is there."))
    else:
        out.append(row(OK, f"1. DEMO_PHONES holds {', '.join(mask(n) for n in numbers)}",
                       "the only numbers anything is allowed to contact"))

    # 2. Twilio has to have verified it, because this is a trial account.
    if verr:
        out.append(row(MEH, "2. Could not check your verified numbers", verr))
    elif not numbers:
        out.append(row(NO, "2. Verify the number with Twilio", "do step 1 first"))
    else:
        missing = [n for n in numbers if n not in verified]
        if missing:
            out.append(row(NO, f"2. Verify {', '.join(mask(n) for n in missing)} with Twilio",
                           "console.twilio.com, Phone Numbers, Manage, Verified Caller IDs, "
                           "Add a new Caller ID. They text you a 6 digit code. A trial "
                           "account cannot text or ring an unverified number."))
        else:
            out.append(row(OK, "2. Twilio has verified every number on the list",
                           "a trial account needs this"))

    # 3. The SMS switch.
    if cfg.mock_twilio:
        out.append(row(NO, "3. Set MOCK_TWILIO=0 in .env",
                       "texts are written to the thread and not sent while this is 1"))
    else:
        out.append(row(OK, "3. MOCK_TWILIO=0, so texts really send", "they will be labelled sms"))

    # 4. A tunnel, so the phone can reach this laptop over https.
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

    # 5. iMessage, which is the channel the link is meant to arrive on. SMS in step 3 is
    # the fallback for when this cannot deliver, and the message always says which one it
    # actually went out on.
    from .comms import notify as texter

    got = texter.status()
    if got.get("imessage"):
        sdk = got.get("sidecar") or {}
        out.append(row(OK, "5. iMessage is configured",
                       f"over {'Spectrum Cloud' if sdk.get('spectrum_cloud') else 'the sidecar'}. "
                       "The link arrives as a "
                       "blue bubble when the transport accepts it, and the stored message "
                       "says which channel it really went out on."))
    else:
        out.append(row(MEH, "5. iMessage is not configured, so the link goes by SMS",
                       "set PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET for iMessage. SMS is a "
                       "real text and the demo works on it; a message is never labelled "
                       "iMessage unless a real iMessage transport reported success."))

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
