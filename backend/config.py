"""Environment, mock switches and paths. Import `cfg` and read fields."""

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_env(path: Path = ROOT / ".env") -> None:
    """Load KEY=VALUE lines from .env without overwriting the real environment."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip())


read_env()


def flag(name: str, keys: list[str]) -> bool:
    """Mock switch: explicit MOCK_X wins, else mock is on when any needed key is blank."""
    raw = os.environ.get(name)
    if raw is not None and raw != "":
        return raw not in ("0", "false", "False", "no")
    return not all(os.environ.get(k) for k in keys)


def num(name: str, default: float) -> float:
    """Float from env with a default."""
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


def on(name: str, default: str = "0") -> bool:
    """A plain on or off switch from env."""
    return (os.environ.get(name) or default) not in ("0", "", "false", "False", "no")


def first(*names: str) -> str:
    """The first of these environment variables that has a value."""
    for name in names:
        val = os.environ.get(name)
        if val:
            return val
    return ""


# Ids worth suggesting when the configured one is not a Gemini model at all. This is a
# handful of examples for an error message, deliberately not an allow list: Google shipped
# six new Gemini ids while this backend was being written, and a list in here would reject
# a model that exists for the sin of being newer than the list. `make check` pings the API
# for the real answer, which is the only answer that is ever current.
EXAMPLE_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest"]
DEFAULT_MODEL = "gemini-2.5-flash"
MODEL_NOTE = ""


def pick_model() -> str:
    """The model id to call, replacing it only when it is not a Gemini id at all.

    A name check cannot tell a model that does not exist from one released last week, so
    it does not try. The one thing it can tell is that `claude-sonnet-5` is never going to
    answer a Gemini request, and a CLAUDE_MODEL left in .env from before this backend
    moved to Gemini is the likely way to get here. That one is replaced, because the
    failure mode otherwise is silent: `llm.ask` falls back to its template on any error,
    so the key looks live, every call 404s, and nothing is ever phrased by the model.

    The reason lands in MODEL_NOTE so `make check` can say so out loud.
    """
    global MODEL_NOTE
    want = (os.environ.get("GEMINI_MODEL") or "").strip()
    if not want:
        return DEFAULT_MODEL
    if want.startswith("gemini-"):
        return want
    MODEL_NOTE = (f"GEMINI_MODEL is {want}, which is not a Gemini model, so "
                  f"{DEFAULT_MODEL} is being used instead. Try one of: "
                  + ", ".join(EXAMPLE_MODELS) + ".")
    return DEFAULT_MODEL


def e164(entry: str) -> str:
    """Just the number out of an allow list entry, in E.164.

    An entry is often written for a human to read, like "Kiruthika +1 925 967 7432" or
    "clinic <+19259677432>", so the digits are pulled out and the rest is dropped. A ten
    digit number is assumed to be North American, which is the only guess here and is
    worth knowing about if you add an international number.
    """
    digits = "".join(ch for ch in str(entry) if ch.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        digits = "1" + digits
    return "+" + digits


def phones(name: str = "DEMO_PHONES") -> list[str]:
    """The allow list of numbers that may be texted or called in live mode.

    Nothing is sent to a number outside this list, ever. People on it have agreed to be
    contacted, and that is the only reason a number is in there. Entries are normalized
    to E.164 so a label written next to the number cannot end up being used as the
    destination, which is a mistake that fails in a confusing way far from here.
    """
    raw = os.environ.get(name) or ""
    out = []
    for part in raw.replace(";", ",").split(","):
        got = e164(part)
        if got and got not in out:
            out.append(got)
    return out


@dataclass
class Cfg:
    """Resolved configuration for the whole backend."""

    # Demo mode. With MOCK_RIG=1 a call can be driven from generated frames instead of a
    # phone, which is how the whole flow runs on a laptop. On by default.
    mock_rig: bool = field(default_factory=lambda: on("MOCK_RIG", "1"))
    # Either key name works. GEMINI_API_KEY is what the Gemini docs tell you to set;
    # GOOGLE_API_KEY is what a Google Cloud console download calls the same thing.
    mock_llm: bool = field(
        default_factory=lambda: flag("MOCK_LLM", ["GEMINI_API_KEY"])
        and flag("MOCK_LLM", ["GOOGLE_API_KEY"])
    )
    # Photon credentials are PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET now. The old
    # PHOTON_API_KEY still counts so an existing .env keeps working.
    mock_photon: bool = field(
        default_factory=lambda: flag("MOCK_PHOTON", ["PHOTON_PROJECT_ID"])
        and flag("MOCK_PHOTON", ["PHOTON_API_KEY"])
    )
    # CREAO agent platform. The briefing agent runs there; this backend only starts runs and
    # reads results, so the key never leaves the server.
    mock_creao: bool = field(default_factory=lambda: flag("MOCK_CREAO", ["CREAO_API_KEY", "CREAO_AGENT_ID"]))
    mock_eleven: bool = field(default_factory=lambda: flag("MOCK_ELEVEN", ["ELEVENLABS_API_KEY"]))
    mock_twilio: bool = field(
        default_factory=lambda: flag(
            "MOCK_TWILIO",
            ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"],
        )
    )
    reach: bool = field(default_factory=lambda: os.environ.get("REACH", "1") not in ("0", ""))
    # Real atlases by default. The Schaefer parcellation is cached under ~/nilearn_data
    # after the first fetch and the HCP connectivity ships inside enigmatoolbox, so this
    # only touches the network once. Every loader falls back on failure, so OFFLINE=1
    # (or no wifi) still gives a working demo on the modelled template.
    offline: bool = field(default_factory=lambda: os.environ.get("OFFLINE", "0") not in ("0", ""))
    use_sbi: bool = field(default_factory=lambda: os.environ.get("USE_SBI", "0") not in ("0", ""))

    # Gemini is called over plain REST with httpx, so it needs no extra package. That is
    # also why there is no SDK to be missing: the only way the LLM is unavailable is a
    # blank key or MOCK_LLM. See DECISIONS.md.
    gemini_model: str = field(default_factory=lambda: pick_model())
    gemini_key: str = field(default_factory=lambda: first("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    # CREAO, the three agent care pipeline. The key never leaves the server: see
    # docs/CREAO.md and the test that asserts it is in no response body.
    creao_key: str = field(default_factory=lambda: os.environ.get("CREAO_API_KEY", ""))
    creao_agent: str = field(default_factory=lambda: os.environ.get("CREAO_AGENT_ID", ""))
    # The pipeline has three roles. A role with no agent id of its own runs as a template, so the
    # pipeline works one agent at a time while they are being built.
    creao_triage_agent: str = field(default_factory=lambda: os.environ.get("CREAO_TRIAGE_AGENT_ID", ""))
    creao_outreach_agent: str = field(default_factory=lambda: os.environ.get("CREAO_OUTREACH_AGENT_ID", ""))
    # Start the pipeline by itself when a check-in is scored. Off by default: every run spends credits.
    auto_agents: bool = field(default_factory=lambda: on("AUTO_AGENT_PIPELINE"))
    creao_url: str = field(default_factory=lambda: (os.environ.get("CREAO_BASE_URL") or "https://agent.creao.ai").rstrip("/"))
    photon_key: str = field(default_factory=lambda: os.environ.get("PHOTON_API_KEY", ""))
    photon_url: str = field(default_factory=lambda: os.environ.get("PHOTON_BASE_URL", ""))
    photon_project: str = field(default_factory=lambda: os.environ.get("PHOTON_PROJECT_ID", ""))
    photon_secret: str = field(default_factory=lambda: os.environ.get("PHOTON_PROJECT_SECRET", ""))
    twilio_sid: str = field(default_factory=lambda: os.environ.get("TWILIO_ACCOUNT_SID", ""))
    twilio_token: str = field(default_factory=lambda: os.environ.get("TWILIO_AUTH_TOKEN", ""))
    # Spec file 2 names it TWILIO_PHONE_NUMBER. TWILIO_FROM was the old name and still works.
    twilio_from: str = field(default_factory=lambda: first("TWILIO_PHONE_NUMBER", "TWILIO_FROM"))

    # ElevenLabs, for the pre-generated voice lines only. Nothing here places a call:
    # the outbound clinic call is gone, so an alert lands in the workspace instead.
    eleven_key: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_API_KEY", ""))
    eleven_voice: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_VOICE_ID", ""))
    eleven_tts_model: str = field(
        default_factory=lambda: os.environ.get("ELEVENLABS_TTS_MODEL") or "eleven_multilingual_v2"
    )

    public_url: str = field(default_factory=lambda: (os.environ.get("PUBLIC_URL") or "").rstrip("/"))
    demo_phones: list[str] = field(default_factory=phones)
    keep_audio: bool = field(default_factory=lambda: on("KEEP_AUDIO"))
    regional_loadings: bool = field(default_factory=lambda: on("REGIONAL_LOADINGS"))

    # Phone screen geometry. Used to convert normalized gaze to degrees of visual angle.
    screen_w_mm: float = field(default_factory=lambda: num("SCREEN_W_MM", 71.5))
    screen_h_mm: float = field(default_factory=lambda: num("SCREEN_H_MM", 147.0))
    view_dist_mm: float = field(default_factory=lambda: num("VIEW_DIST_MM", 300.0))

    api_base: str = field(default_factory=lambda: os.environ.get("API_BASE", "http://localhost:8000"))
    data_dir: Path = field(default_factory=lambda: ROOT / (os.environ.get("DATA_DIR") or "data"))
    db_path: Path = field(
        default_factory=lambda: ROOT / (os.environ.get("DB_PATH") or "data/synapshot.db")
    )

    # Clinician accounts. Set AUTH_ENABLED=1 to require sign-in at /login for both
    # clinician shells. With it off the local demo runs as the synthetic admin.
    auth_enabled: bool = field(default_factory=lambda: on("AUTH_ENABLED", "0"))
    demo_login: bool = field(default_factory=lambda: on("DEMO_LOGIN", "1"))
    demo_email: str = field(
        default_factory=lambda: os.environ.get("DEMO_EMAIL") or "reyes@synapshot.health"
    )
    demo_password: str = field(
        default_factory=lambda: os.environ.get("DEMO_PASSWORD") or "synapshot-demo"
    )
    session_ttl_h: float = field(default_factory=lambda: num("SESSION_TTL_H", 12.0))

    # Veri. The decision model is optional: with no key the deterministic heuristic runs
    # and every response says so.
    veri_api_key: str = field(default_factory=lambda: os.environ.get("VERI_API_KEY", ""))
    veri_api_url: str = field(
        default_factory=lambda: (os.environ.get("VERI_API_URL") or "https://api.veri.studio").rstrip("/")
    )
    veri_deployment_id: str = field(default_factory=lambda: os.environ.get("VERI_DEPLOYMENT_ID", ""))
    veri_model: str = field(default_factory=lambda: os.environ.get("VERI_MODEL") or "synapshot-adaptive")
    adaptive_mode: str = field(
        default_factory=lambda: (os.environ.get("ADAPTIVE_MODE") or "heuristic").lower()
    )

    def veri_live(self) -> bool:
        """True only when the model can actually be called."""
        return bool(self.veri_api_key and self.veri_deployment_id and self.adaptive_mode == "veri")

    def mode(self) -> str:
        """'mock' when anything is mocked, else 'live'."""
        mocked = (self.mock_rig or self.mock_llm or self.mock_photon or self.mock_twilio
                  or self.mock_eleven)
        return "mock" if mocked else "live"

    def base_url(self) -> str:
        """The URL a texted link must use. PUBLIC_URL in live mode, else the local base.

        iOS will not open the camera over plain http, so a localhost link cannot work on
        a phone. `make tunnel` prints how to get an https one.
        """
        return self.public_url or self.api_base

    def may_text(self, number: str) -> bool:
        """Whether a number may be texted. Only numbers on the DEMO_PHONES allow list."""
        want = "".join(ch for ch in str(number) if ch.isdigit())
        if not want:
            return False
        return any("".join(ch for ch in p if ch.isdigit()) == want for p in self.demo_phones)

    def cache_dir(self) -> Path:
        """Disk cache for DMF fits and the surrogate table."""
        out = self.data_dir / "cache"
        out.mkdir(parents=True, exist_ok=True)
        return out


cfg = Cfg()
cfg.data_dir.mkdir(parents=True, exist_ok=True)

# Stimulus page is 1080x1920 logical, portrait. Gaze is reported normalized to it.
STIM_W = 1080
STIM_H = 1920


def deg_per_unit() -> tuple[float, float]:
    """Degrees of visual angle per normalized screen unit, horizontal and vertical.

    deg_x = 2 * atan(screen_w_mm / 2 / view_dist_mm) in degrees, over 1.0 normalized units
    """
    import math

    dx = math.degrees(2 * math.atan(cfg.screen_w_mm / 2 / cfg.view_dist_mm))
    dy = math.degrees(2 * math.atan(cfg.screen_h_mm / 2 / cfg.view_dist_mm))
    return dx, dy
