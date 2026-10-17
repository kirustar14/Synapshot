"""Screen capture of the FaceTime window into a timestamped ring buffer.

Every frame carries time.monotonic_ns() from the Mac clock, which is the same clock the
stimulus page is mapped onto, so a stimulus event and a video frame can be compared
directly. Capture runs at 30 fps and drops to 15 when the machine cannot keep up.
JPEG frames go to the rig websocket at about 5 fps for the console, separately from the
full rate buffer the features read.
"""

import threading
import time

import numpy as np

FPS = 30.0
FPS_FALLBACK = 15.0
PUSH_FPS = 5.0
RING_S = 180.0      # three minutes of frames is enough for any single task


def grabber():
    """An mss screen grabber, or None when mss is not installed."""
    try:
        import mss

        return mss.mss()
    except Exception:
        return None


def window_region(title: str = "FaceTime") -> dict | None:
    """Screen rectangle of the FaceTime window, via Quartz, or None."""
    try:
        from Quartz import (
            CGWindowListCopyWindowInfo,
            kCGNullWindowID,
            kCGWindowListOptionOnScreenOnly,
        )

        for win in CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) or []:
            owner = str(win.get("kCGWindowOwnerName", ""))
            if title.lower() not in owner.lower():
                continue
            box = win.get("kCGWindowBounds") or {}
            if float(box.get("Height", 0)) < 200:
                continue
            return {
                "left": int(box.get("X", 0)), "top": int(box.get("Y", 0)),
                "width": int(box.get("Width", 0)), "height": int(box.get("Height", 0)),
            }
    except Exception:
        return None
    return None


def full_screen() -> dict:
    """The primary display rectangle, the fallback when the window is not found."""
    sct = grabber()
    if sct is None:
        return {"left": 0, "top": 0, "width": 1280, "height": 800}
    mon = sct.monitors[1]
    return {"left": mon["left"], "top": mon["top"], "width": mon["width"], "height": mon["height"]}


def capture(region: dict | None = None, seconds: float = 20.0, fps: float = FPS, on_frame=None) -> list[dict]:
    """Grab frames for a fixed time, each one timestamped and turned into a frame record.

    Returns the frame records face.py produces, so the features do not know or care
    whether the pixels came from a screen or from a file.
    """
    from backend.features import face

    sct = grabber()
    if sct is None:
        return []
    box = region or window_region() or full_screen()
    step = 1.0 / fps
    out: list[dict] = []
    end = time.monotonic() + seconds
    push_every = max(1, int(fps / PUSH_FPS))
    i = 0
    late = 0
    while time.monotonic() < end:
        t_ns = time.monotonic_ns()
        shot = np.asarray(sct.grab(box))[:, :, :3][:, :, ::-1]  # BGRA to RGB
        rec = face.from_image(shot, t_ns)
        out.append(rec)
        if on_frame is not None and i % push_every == 0:
            on_frame(rec, shot)
        i += 1
        slack = step - (time.monotonic_ns() - t_ns) / 1e9
        if slack > 0:
            time.sleep(slack)
        else:
            late += 1
            if late > fps and fps > FPS_FALLBACK:
                return out + capture(box, max(0.0, end - time.monotonic()), FPS_FALLBACK, on_frame)
    return out


def jpeg(img: np.ndarray, quality: int = 55, width: int = 420) -> str:
    """Base64 JPEG of a frame for the rig console, or an empty string without cv2."""
    import base64

    try:
        import cv2

        arr = np.asarray(img)
        scale = width / max(1, arr.shape[1])
        small = cv2.resize(arr, (width, max(1, int(arr.shape[0] * scale))))
        ok, buf = cv2.imencode(".jpg", small[:, :, ::-1], [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if not ok:
            return ""
        return base64.b64encode(buf.tobytes()).decode()
    except Exception:
        return ""


def ring(seconds: float = RING_S, fps: float = FPS) -> dict:
    """A background capture thread with a ring buffer. Start, read, stop."""
    state = {"frames": [], "run": True, "fps": fps, "region": None, "late": 0}
    cap = int(seconds * fps)

    def loop():
        from backend.features import face

        sct = grabber()
        if sct is None:
            state["run"] = False
            return
        box = window_region() or full_screen()
        state["region"] = box
        step = 1.0 / state["fps"]
        while state["run"]:
            t_ns = time.monotonic_ns()
            try:
                shot = np.asarray(sct.grab(box))[:, :, :3][:, :, ::-1]
            except Exception:
                break
            state["frames"].append(face.from_image(shot, t_ns))
            if len(state["frames"]) > cap:
                del state["frames"][: len(state["frames"]) - cap]
            slack = step - (time.monotonic_ns() - t_ns) / 1e9
            if slack > 0:
                time.sleep(slack)
            else:
                state["late"] += 1
                if state["late"] > 60 and state["fps"] > FPS_FALLBACK:
                    state["fps"] = FPS_FALLBACK
                    step = 1.0 / state["fps"]

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    state["thread"] = thread
    return state


def since(state: dict, t_ns: int) -> list[dict]:
    """Frames in the ring buffer captured at or after a timestamp."""
    return [f for f in list(state["frames"]) if f["t_ns"] >= t_ns]


def stop(state: dict) -> None:
    """Stop a ring buffer thread."""
    state["run"] = False


def check() -> dict:
    """Preflight: can we grab the screen and find the FaceTime window."""
    sct = grabber()
    region = window_region()
    return {
        "mss": sct is not None,
        "facetime_window": region is not None,
        "region": region or full_screen(),
        "fps_target": FPS,
    }
