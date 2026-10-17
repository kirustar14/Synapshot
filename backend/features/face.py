"""MediaPipe Face Landmarker, plus the frame record every other feature module reads.

A frame record is a plain dict so a mock session and a real capture are the same thing
downstream. MediaPipe is optional: without it `from_image` returns a frame with
face False and the pipeline reports a quality failure instead of crashing.
"""

import numpy as np

# MediaPipe face mesh indices. Iris centres need the iris refinement to be on.
IRIS_L = [468, 469, 470, 471, 472]
IRIS_R = [473, 474, 475, 476, 477]
EYE_L_OUT, EYE_L_IN = 33, 133
EYE_R_IN, EYE_R_OUT = 362, 263
LID_L_UP, LID_L_DN = 159, 145
LID_R_UP, LID_R_DN = 386, 374
NOSE, CHIN = 1, 152

_LM = None
_TRIED = False


def landmarker():
    """Cached MediaPipe FaceLandmarker with iris and blendshapes on, or None."""
    global _LM, _TRIED
    if _TRIED:
        return _LM
    _TRIED = True
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision

        path = _model_path()
        if path is None:
            _LM = None
            return _LM
        opts = vision.FaceLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=str(path)),
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=1,
            running_mode=vision.RunningMode.IMAGE,
        )
        _LM = vision.FaceLandmarker.create_from_options(opts)
        del mp
    except Exception:
        _LM = None
    return _LM


def _model_path():
    """Path to face_landmarker.task, downloaded once into the data dir, or None."""
    from ..config import cfg

    path = cfg.data_dir / "models" / "face_landmarker.task"
    if path.exists():
        return path
    if cfg.offline:
        return None
    try:
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        url = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/"
               "face_landmarker/float16/1/face_landmarker.task")
        urllib.request.urlretrieve(url, str(path))
        return path if path.exists() else None
    except Exception:
        return None


def blank(t_ns: int, lum: float = 0.0) -> dict:
    """A frame record with no face in it."""
    return {"t_ns": int(t_ns), "face": False, "lum": float(lum), "ratio": (0.5, 0.5),
            "pose": (0.0, 0.0, 0.0), "ear": 0.3, "iris_px": 0.0, "blend": {}}


def from_image(img: np.ndarray, t_ns: int) -> dict:
    """One frame record from an RGB image, using MediaPipe when it is available."""
    lum = float(np.asarray(img, dtype=float).mean() / 255.0) if img is not None else 0.0
    lm = landmarker()
    if lm is None or img is None:
        return blank(t_ns, lum)
    try:
        import mediapipe as mp

        mpimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img, dtype=np.uint8))
        got = lm.detect(mpimg)
    except Exception:
        return blank(t_ns, lum)
    if not got.face_landmarks:
        return blank(t_ns, lum)

    pts = np.array([[p.x, p.y, p.z] for p in got.face_landmarks[0]])
    blend = {}
    if got.face_blendshapes:
        blend = {b.category_name: float(b.score) for b in got.face_blendshapes[0]}
    return {
        "t_ns": int(t_ns),
        "face": True,
        "lum": lum,
        "ratio": ratios(pts),
        "pose": pose(pts, got),
        "ear": ear(pts),
        "iris_px": iris_px(pts, img.shape[1] if img is not None else 1),
        "blend": blend,
    }


def ratios(pts: np.ndarray) -> tuple[float, float]:
    """Horizontal and vertical gaze ratios, averaged over both eyes.

    hx = (iris_x - corner_out_x) / (corner_in_x - corner_out_x)
    hy = (iris_y - lid_up_y) / (lid_dn_y - lid_up_y)
    Both are 0.5 when the iris sits centred between the landmarks.
    """
    lx = pts[IRIS_L, 0].mean()
    ly = pts[IRIS_L, 1].mean()
    rx = pts[IRIS_R, 0].mean()
    ry = pts[IRIS_R, 1].mean()
    hl = (lx - pts[EYE_L_OUT, 0]) / (pts[EYE_L_IN, 0] - pts[EYE_L_OUT, 0] + 1e-9)
    hr = (rx - pts[EYE_R_OUT, 0]) / (pts[EYE_R_IN, 0] - pts[EYE_R_OUT, 0] + 1e-9)
    vl = (ly - pts[LID_L_UP, 1]) / (pts[LID_L_DN, 1] - pts[LID_L_UP, 1] + 1e-9)
    vr = (ry - pts[LID_R_UP, 1]) / (pts[LID_R_DN, 1] - pts[LID_R_UP, 1] + 1e-9)
    return float(np.clip((hl + hr) / 2, -1, 2)), float(np.clip((vl + vr) / 2, -1, 2))


def pose(pts: np.ndarray, got=None) -> tuple[float, float, float]:
    """Yaw, pitch and roll in degrees, from the transformation matrix or the landmarks."""
    if got is not None and getattr(got, "facial_transformation_matrixes", None):
        mat = np.asarray(got.facial_transformation_matrixes[0])[:3, :3]
        yaw = np.degrees(np.arctan2(mat[0, 2], mat[2, 2]))
        pitch = np.degrees(np.arcsin(-np.clip(mat[1, 2], -1, 1)))
        roll = np.degrees(np.arctan2(mat[1, 0], mat[1, 1]))
        return float(yaw), float(pitch), float(roll)
    mid = (pts[EYE_L_OUT] + pts[EYE_R_OUT]) / 2
    yaw = np.degrees(np.arctan2(pts[NOSE, 0] - mid[0], 0.1))
    pitch = np.degrees(np.arctan2(pts[NOSE, 1] - mid[1], 0.1))
    roll = np.degrees(np.arctan2(pts[EYE_R_OUT, 1] - pts[EYE_L_OUT, 1], pts[EYE_R_OUT, 0] - pts[EYE_L_OUT, 0]))
    return float(yaw), float(pitch), float(roll)


def ear(pts: np.ndarray) -> float:
    """Eye aspect ratio, averaged over both eyes.

    EAR = lid opening / eye width, about 0.3 open and under 0.15 closed
    """
    wl = abs(pts[EYE_L_IN, 0] - pts[EYE_L_OUT, 0]) + 1e-9
    wr = abs(pts[EYE_R_IN, 0] - pts[EYE_R_OUT, 0]) + 1e-9
    el = abs(pts[LID_L_DN, 1] - pts[LID_L_UP, 1]) / wl
    er = abs(pts[LID_R_DN, 1] - pts[LID_R_UP, 1]) / wr
    return float((el + er) / 2)


def iris_px(pts: np.ndarray, width_px: int) -> float:
    """Iris diameter in pixels, the distance proxy. A real iris is about 11.7 mm."""
    dl = np.linalg.norm(pts[IRIS_L[1], :2] - pts[IRIS_L[3], :2]) * width_px
    dr = np.linalg.norm(pts[IRIS_R[1], :2] - pts[IRIS_R[3], :2]) * width_px
    return float((dl + dr) / 2)


def available() -> bool:
    """True when a real landmarker could be built."""
    return landmarker() is not None


def pupil_light_reflex(*args, **kwargs):
    """Pupil light reflex is not implemented."""
    raise NotImplementedError("roadmap")
