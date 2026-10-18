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


def phones(name: str = "DEMO_PHONES") -> list[str]:
    """The allow list of numbers that may be texted in live mode.

    Nothing is sent to a number outside this list, ever. People on it have agreed to be
    texted, and that is the only reason a number is in there.
    """
    raw = os.environ.get(name) or ""
    return [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]


@dataclass
class Cfg:
    """Resolved configuration for the whole backend."""

    mock_rig: bool = field(default_factory=lambda: flag("MOCK_RIG", ["RIG_FACETIME_NUMBER"]))
    mock_llm: bool = field(default_factory=lambda: flag("MOCK_LLM", ["ANTHROPIC_API_KEY"]))
    # Photon credentials are PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET now. The old
    # PHOTON_API_KEY still counts so an existing .env keeps working.
    mock_photon: bool = field(
        default_factory=lambda: flag("MOCK_PHOTON", ["PHOTON_PROJECT_ID"])
        and flag("MOCK_PHOTON", ["PHOTON_API_KEY"])
    )
    mock_eleven: bool = field(default_factory=lambda: flag("MOCK_ELEVEN", ["ELEVENLABS_API_KEY"]))
    mock_twilio: bool = field(
        default_factory=lambda: flag(
            "MOCK_TWILIO",
            ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "CLINIC_NUMBER"],
        )
    )
    reach: bool = field(default_factory=lambda: os.environ.get("REACH", "1") not in ("0", ""))
    # Real atlases by default. The Schaefer parcellation is cached under ~/nilearn_data
    # after the first fetch and the HCP connectivity ships inside enigmatoolbox, so this
    # only touches the network once. Every loader falls back on failure, so OFFLINE=1
    # (or no wifi) still gives a working demo on the modelled template.
    offline: bool = field(default_factory=lambda: os.environ.get("OFFLINE", "0") not in ("0", ""))
    use_sbi: bool = field(default_factory=lambda: os.environ.get("USE_SBI", "0") not in ("0", ""))

    # The brief asks for a default of claude-sonnet-5-5, which is not a model that
    # exists and would 404. The nearest real one is claude-sonnet-5. See DECISIONS.md.
    claude_model: str = field(
        default_factory=lambda: os.environ.get("CLAUDE_MODEL") or "claude-sonnet-5"
    )
    anthropic_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    photon_key: str = field(default_factory=lambda: os.environ.get("PHOTON_API_KEY", ""))
    photon_url: str = field(default_factory=lambda: os.environ.get("PHOTON_BASE_URL", ""))
    photon_project: str = field(default_factory=lambda: os.environ.get("PHOTON_PROJECT_ID", ""))
    photon_secret: str = field(default_factory=lambda: os.environ.get("PHOTON_PROJECT_SECRET", ""))
    twilio_sid: str = field(default_factory=lambda: os.environ.get("TWILIO_ACCOUNT_SID", ""))
    twilio_token: str = field(default_factory=lambda: os.environ.get("TWILIO_AUTH_TOKEN", ""))
    # Spec file 2 names it TWILIO_PHONE_NUMBER. TWILIO_FROM was the old name and still works.
    twilio_from: str = field(default_factory=lambda: first("TWILIO_PHONE_NUMBER", "TWILIO_FROM"))
    clinic_number: str = field(default_factory=lambda: os.environ.get("CLINIC_NUMBER", ""))

    # ElevenLabs. Voice lines, the optional speech to text backend and the clinic call.
    eleven_key: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_API_KEY", ""))
    eleven_voice: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_VOICE_ID", ""))
    eleven_agent: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_AGENT_ID", ""))
    eleven_phone: str = field(default_factory=lambda: os.environ.get("ELEVENLABS_PHONE_NUMBER_ID", ""))
    eleven_tts_model: str = field(
        default_factory=lambda: os.environ.get("ELEVENLABS_TTS_MODEL") or "eleven_multilingual_v2"
    )
    eleven_stt_model: str = field(
        default_factory=lambda: os.environ.get("ELEVENLABS_STT_MODEL") or "scribe_v1"
    )

    # The web call. CALL_MODE=facetime keeps the old rig path alive.
    call_mode: str = field(default_factory=lambda: (os.environ.get("CALL_MODE") or "web").lower())
    public_url: str = field(default_factory=lambda: (os.environ.get("PUBLIC_URL") or "").rstrip("/"))
    demo_phones: list[str] = field(default_factory=phones)
    keep_audio: bool = field(default_factory=lambda: on("KEEP_AUDIO"))
    asr: str = field(default_factory=lambda: (os.environ.get("ASR") or "whisper").lower())
    live_agent: bool = field(default_factory=lambda: on("LIVE_AGENT"))
    regional_loadings: bool = field(default_factory=lambda: on("REGIONAL_LOADINGS"))

    facetime_number: str = field(default_factory=lambda: os.environ.get("RIG_FACETIME_NUMBER", ""))
    mic_device: str = field(default_factory=lambda: os.environ.get("MIC_DEVICE", "BlackHole 2ch"))
    spk_device: str = field(default_factory=lambda: os.environ.get("SPK_DEVICE", "BlackHole 16ch"))
    capture_fps: float = field(default_factory=lambda: num("CAPTURE_FPS", 30))

    # Phone screen geometry. Used to convert normalized gaze to degrees of visual angle.
    screen_w_mm: float = field(default_factory=lambda: num("SCREEN_W_MM", 71.5))
    screen_h_mm: float = field(default_factory=lambda: num("SCREEN_H_MM", 147.0))
    view_dist_mm: float = field(default_factory=lambda: num("VIEW_DIST_MM", 300.0))

    api_base: str = field(default_factory=lambda: os.environ.get("API_BASE", "http://localhost:8000"))
    data_dir: Path = field(default_factory=lambda: ROOT / (os.environ.get("DATA_DIR") or "data"))
    db_path: Path = field(
        default_factory=lambda: ROOT / (os.environ.get("DB_PATH") or "data/unnamed.db")
    )

    def mode(self) -> str:
        """'mock' when anything is mocked, else 'live'."""
        mocked = (self.mock_rig or self.mock_llm or self.mock_photon or self.mock_twilio
                  or self.mock_eleven)
        return "mock" if mocked else "live"

    def web_call(self) -> bool:
        """True when the patient opens a web page instead of answering a FaceTime call."""
        return self.call_mode != "facetime"

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
