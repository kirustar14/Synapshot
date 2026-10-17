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


@dataclass
class Cfg:
    """Resolved configuration for the whole backend."""

    mock_rig: bool = field(default_factory=lambda: flag("MOCK_RIG", ["RIG_FACETIME_NUMBER"]))
    mock_llm: bool = field(default_factory=lambda: flag("MOCK_LLM", ["ANTHROPIC_API_KEY"]))
    mock_photon: bool = field(default_factory=lambda: flag("MOCK_PHOTON", ["PHOTON_API_KEY"]))
    mock_twilio: bool = field(
        default_factory=lambda: flag(
            "MOCK_TWILIO",
            ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "CLINIC_NUMBER"],
        )
    )
    reach: bool = field(default_factory=lambda: os.environ.get("REACH", "1") not in ("0", ""))
    # Offline by default: template loaders that would download an atlas are skipped so a
    # demo never blocks on the conference wifi. Set OFFLINE=0 to fetch the real atlases.
    offline: bool = field(default_factory=lambda: os.environ.get("OFFLINE", "1") not in ("0", ""))
    use_sbi: bool = field(default_factory=lambda: os.environ.get("USE_SBI", "0") not in ("0", ""))

    # The brief asks for a default of claude-sonnet-5-5, which is not a model that
    # exists and would 404. The nearest real one is claude-sonnet-5. See DECISIONS.md.
    claude_model: str = field(
        default_factory=lambda: os.environ.get("CLAUDE_MODEL") or "claude-sonnet-5"
    )
    anthropic_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    photon_key: str = field(default_factory=lambda: os.environ.get("PHOTON_API_KEY", ""))
    photon_url: str = field(default_factory=lambda: os.environ.get("PHOTON_BASE_URL", ""))
    twilio_sid: str = field(default_factory=lambda: os.environ.get("TWILIO_ACCOUNT_SID", ""))
    twilio_token: str = field(default_factory=lambda: os.environ.get("TWILIO_AUTH_TOKEN", ""))
    twilio_from: str = field(default_factory=lambda: os.environ.get("TWILIO_FROM", ""))
    clinic_number: str = field(default_factory=lambda: os.environ.get("CLINIC_NUMBER", ""))

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
        return "mock" if (self.mock_rig or self.mock_llm or self.mock_photon or self.mock_twilio) else "live"

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
