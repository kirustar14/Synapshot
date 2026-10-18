"""Clinician accounts and clinic scoping.

Passwords are scrypt with a per user salt. Session tokens are random, stored hashed, and
carried in an HttpOnly cookie. A clinician sees the patients assigned to them; an admin
sees everyone in their clinic. Anything outside that answers 404 rather than 403, so a
signed in clinician cannot probe which patient ids exist at another clinic.

AUTH_ENABLED=0 turns the whole thing into a synthetic admin. The test suite sets it, and
so does a checkout that has not been seeded yet.
"""

import base64
import hashlib
import hmac
import secrets
import threading
import time

from fastapi import HTTPException, Request

from . import db
from .config import cfg

COOKIE = "syn_session"
SCRYPT_N, SCRYPT_R, SCRYPT_P = 16384, 8, 1
RATE_WINDOW = 15 * 60
RATE_MAX = 5

_FAILS: dict[str, list[float]] = {}
_LOCK = threading.RLock()

DEMO_ADMIN = {
    "id": "clin_demo",
    "email": "demo@synapshot.health",
    "name": "Demo clinician",
    "role": "admin",
    "clinic_id": "",
    "clinic_name": "Synapshot demo clinic",
}


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    """scrypt$n$r$p$salt$key, all parameters stored with the hash."""
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R,
                         p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant time check against a stored hash. Any malformed value is a no."""
    try:
        scheme, n, r, p, salt, key = str(stored).split("$")
        if scheme != "scrypt":
            return False
        want = base64.b64decode(key)
        got = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt),
                             n=int(n), r=int(r), p=int(p), dklen=len(want))
        return hmac.compare_digest(got, want)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _rate_ok(key: str) -> bool:
    """Five failed attempts per email per fifteen minutes."""
    now = time.time()
    with _LOCK:
        hits = [t for t in _FAILS.get(key, []) if now - t < RATE_WINDOW]
        _FAILS[key] = hits
        return len(hits) < RATE_MAX


def _note_fail(key: str) -> None:
    with _LOCK:
        _FAILS.setdefault(key, []).append(time.time())


def _clinician_row(clinician_id: str):
    return db.one(
        "select c.*, k.name as clinic_name from clinicians c"
        " left join clinics k on k.id = c.clinic_id where c.id=?",
        (clinician_id,),
    )


def _shape(row) -> dict:
    """The fields the API may return. Never the hash."""
    got = dict(row) if not isinstance(row, dict) else row
    return {
        "id": str(got.get("id") or ""),
        "email": str(got.get("email") or ""),
        "name": str(got.get("name") or ""),
        "role": str(got.get("role") or "doctor"),
        "clinic_id": str(got.get("clinic_id") or ""),
        "clinic_name": str(got.get("clinic_name") or ""),
        "last_login": got.get("last_login"),
    }


def login(email: str, password: str, user_agent: str = "") -> dict | None:
    """Check a password and mint a session. None means the same thing for every failure."""
    key = email.strip().lower()
    if not key or not password or not _rate_ok(key):
        return None
    row = db.one("select * from clinicians where lower(email)=?", (key,))
    if row is None or not verify_password(password, str(row["password_hash"] or "")):
        _note_fail(key)
        return None

    token = secrets.token_urlsafe(32)
    expires = time.time() + cfg.session_ttl_h * 3600
    db.put("clinician_sessions", {
        "token_hash": _token_hash(token),
        "clinician_id": str(row["id"]),
        "created": db.now(),
        "expires": expires,
        "user_agent": (user_agent or "")[:300],
    })
    db.patch("clinicians", str(row["id"]), {"last_login": db.now()})
    who = _clinician_row(str(row["id"])) or row
    return {"token": token, "expires": expires, "clinician": _shape(who)}


def demo_login() -> dict | None:
    """The one click demo account. Only when DEMO_LOGIN=1 and the account exists."""
    if not cfg.demo_login:
        return None
    return login(cfg.demo_email, cfg.demo_password)


def logout(token: str | None) -> None:
    if token:
        db.run("delete from clinician_sessions where token_hash=?", (_token_hash(token),))


def from_token(token: str | None) -> dict | None:
    """A clinician for this session token, or None when it is expired or unknown."""
    if not token:
        return None
    row = db.one(
        "select s.expires, c.*, k.name as clinic_name from clinician_sessions s"
        " join clinicians c on c.id = s.clinician_id"
        " left join clinics k on k.id = c.clinic_id"
        " where s.token_hash=?",
        (_token_hash(token),),
    )
    if row is None:
        return None
    if float(row["expires"] or 0) < time.time():
        logout(token)
        return None
    return _shape(row)


def token_of(request: Request) -> str | None:
    return request.cookies.get(COOKIE)


def from_request(request: Request) -> dict | None:
    """The signed in clinician, or the synthetic admin when auth is off."""
    if not cfg.auth_enabled:
        return dict(DEMO_ADMIN)
    return from_token(token_of(request))


def current(request: Request) -> dict:
    """A clinician or a 401. Used by every route outside the public allow list."""
    who = from_request(request)
    if who is None:
        raise HTTPException(401, "sign in required")
    return who


def patient_ids(who: dict) -> list[str] | None:
    """Assigned patients. None means every patient, which only happens with auth off."""
    if not cfg.auth_enabled:
        return None
    rows = db.rows(
        "select distinct patient_id from assignments where clinician_id=? and active=1",
        (who.get("id", ""),),
    )
    out = [str(r["patient_id"]) for r in rows]
    if str(who.get("role") or "") == "admin" and who.get("clinic_id"):
        extra = db.rows("select id from patients where clinic_id=?", (who.get("clinic_id"),))
        out += [str(r["id"]) for r in extra if str(r["id"]) not in out]
    return out


def can_access(pid: str, who: dict) -> bool:
    allowed = patient_ids(who)
    return allowed is None or pid in allowed


def require_patient(pid: str, request: Request) -> dict:
    """Scope one patient read. 404 on a missing patient or one belonging to someone else.

    Existence is checked even when auth is off, because a route that says 404 for an
    unknown id is part of the contract and the old `need()` check used to live in the
    route itself.
    """
    who = from_request(request)
    if who is None:
        raise HTTPException(401, "sign in required")
    if db.patient(pid) is None or not can_access(pid, who):
        raise HTTPException(404, f"no patient {pid}")
    return who


def scoped_patients(request: Request) -> list[str] | None:
    """The patient id list for list endpoints, or None when everything is visible."""
    who = from_request(request)
    if who is None:
        raise HTTPException(401, "sign in required")
    return patient_ids(who)


def cookie_secure() -> bool:
    """Secure cookies only when the public URL is https."""
    return cfg.public_url.startswith("https://")
