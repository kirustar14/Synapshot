"""Per call quality gates. A failing gate blocks the eye tasks and logs low_quality."""

import numpy as np

FACE_SHARE = 0.7      # share of frames with a face
IRIS_PX_LO = 9.0      # iris diameter below this means the phone is too far away
IRIS_PX_HI = 40.0     # and above it means too close for the whole face to be in frame
BRIGHT_LO = 0.18      # mean luminance, 0 to 1
BRIGHT_HI = 0.92
FPS_LO = 15.0
FLASHES = 3           # test flashes that must be detected before the eye tasks


def face_share(frames: list[dict]) -> float:
    """Share of frames where a face was found."""
    if not frames:
        return 0.0
    return float(np.mean([1.0 if f.get("face") else 0.0 for f in frames]))


def fps_of(frames: list[dict]) -> float:
    """Frame rate from the monotonic timestamps."""
    ts = [f["t_ns"] for f in frames if f.get("t_ns")]
    if len(ts) < 2:
        return 0.0
    span = (max(ts) - min(ts)) / 1e9
    return float((len(ts) - 1) / span) if span > 0 else 0.0


def brightness(frames: list[dict]) -> float:
    """Mean luminance over frames with a face, 0 to 1."""
    vals = [f.get("lum", 0.0) for f in frames if f.get("face")]
    return float(np.mean(vals)) if vals else 0.0


def distance_px(frames: list[dict]) -> float:
    """Median iris diameter in pixels over frames with a face."""
    vals = [f.get("iris_px", 0.0) for f in frames if f.get("face") and f.get("iris_px")]
    return float(np.median(vals)) if vals else 0.0


def gates(frames: list[dict], flashes_found: int = FLASHES, calib_err_deg: float = 0.0) -> dict:
    """Run every gate and return pass or fail with the reason that failed first."""
    share = face_share(frames)
    fps = fps_of(frames)
    bright = brightness(frames)
    iris = distance_px(frames)

    checks = [
        ("face_present", share >= FACE_SHARE, f"a face was visible in {share:.0%} of frames, gate is {FACE_SHARE:.0%}"),
        ("frame_rate", fps >= FPS_LO, f"{fps:.1f} fps, gate is {FPS_LO:.0f}"),
        ("brightness", BRIGHT_LO <= bright <= BRIGHT_HI, f"mean luminance {bright:.2f}, gate is {BRIGHT_LO} to {BRIGHT_HI}"),
        ("distance", IRIS_PX_LO <= iris <= IRIS_PX_HI, f"iris diameter {iris:.1f} px, gate is {IRIS_PX_LO} to {IRIS_PX_HI} px"),
        ("flash_test", flashes_found >= FLASHES, f"{flashes_found} of {FLASHES} test flashes detected"),
    ]
    bad = [c for c in checks if not c[1]]
    return {
        "ok": not bad,
        "reason": "" if not bad else f"{bad[0][0]}: {bad[0][2]}",
        "checks": [{"name": nm, "ok": bool(ok), "detail": why} for nm, ok, why in checks],
        "face_share": share,
        "fps": fps,
        "brightness": bright,
        "iris_px": iris,
        "calib_err_deg": float(calib_err_deg),
        "eye_tasks_ok": (not bad) and float(calib_err_deg) <= 3.0,
    }


def channel(frames: list[dict], flash_ok: bool, calib_err_deg: float) -> dict:
    """The Channel object the contract asks for."""
    return {
        "fps": round(fps_of(frames), 2),
        "calib_err_deg": round(float(calib_err_deg), 2),
        "face_share": round(face_share(frames), 3),
        "flash_ok": bool(flash_ok),
    }
