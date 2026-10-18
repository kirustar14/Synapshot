"""Clinics, clinicians, and who is responsible for which patient.

The demo team is deterministic: fixed ids, fixed clinics, one account per role. Seeding is
idempotent, so `make seed`, a demo reset and a server restart all land in the same state.
Passwords are only written when the account is created, never on a later boot.
"""

from . import auth, db
from .config import cfg

UCLA = "clinic_ucla"
CEDAR = "clinic_cedar"

CLINICS = [
    (UCLA, "UCLA Neurology", "America/Los_Angeles"),
    (CEDAR, "Cedar Rehabilitation", "America/Los_Angeles"),
]

# id, email, name, role, clinic. The first one is the demo login.
STAFF = [
    ("clin_reyes", cfg.demo_email, "Dr. Ana Reyes", "admin", UCLA),
    ("clin_lee", "lee@synapshot.health", "Dr. Marcus Lee", "doctor", UCLA),
    ("clin_ng", "ng@synapshot.health", "Priya Ng", "nurse", UCLA),
    ("clin_okafor", "okafor@synapshot.health", "Dr. Ife Okafor", "doctor", CEDAR),
]


def ensure_demo() -> dict:
    """Create the demo clinics and accounts, then assign whatever patients exist."""
    for cid, name, tz in CLINICS:
        if db.one("select id from clinics where id=?", (cid,)) is None:
            db.put("clinics", {"id": cid, "name": name, "timezone": tz, "created": db.now()})

    made = 0
    for cid, email, name, role, clinic in STAFF:
        if db.one("select id from clinicians where id=?", (cid,)) is None:
            db.put("clinicians", {
                "id": cid, "email": email, "password_hash": auth.hash_password(cfg.demo_password),
                "name": name, "role": role, "clinic_id": clinic,
                "created": db.now(), "last_login": None,
            })
            made += 1

    assigned = assign_demo()
    return {"clinicians_created": made, "assignments": assigned,
            "email": cfg.demo_email, "demo_password_set": bool(cfg.demo_password)}


def assign_demo() -> int:
    """Give every patient a clinic and a primary clinician.

    Five of the six demo patients land at UCLA and one at Cedar, so signing in as the two
    doctors shows two genuinely different worklists. A patient with no assignment yet is
    handed out round robin.
    """
    rows = db.patients()
    if not rows:
        return 0
    staff = [row for row in db.rows("select * from clinicians order by id") if row]
    if not staff:
        return 0
    ucla = [s for s in staff if str(s["clinic_id"]) == UCLA] or staff
    cedar = [s for s in staff if str(s["clinic_id"]) == CEDAR]

    count = 0
    ordered = sorted(rows, key=lambda r: str(r["created"] or ""))
    for i, pat in enumerate(ordered):
        pid = str(pat["id"])
        clinic = CEDAR if (cedar and i == len(ordered) - 1) else UCLA
        if str(pat["clinic_id"] or "") != clinic:
            db.patch("patients", pid, {"clinic_id": clinic})
        pool = (cedar if clinic == CEDAR else ucla) or staff
        primary = pool[i % len(pool)]
        if db.one("select id from assignments where patient_id=? and clinician_id=?",
                  (pid, str(primary["id"]))) is not None:
            continue
        db.put("assignments", {
            "id": f"as_{pid}_{primary['id']}",
            "patient_id": pid,
            "clinician_id": str(primary["id"]),
            "clinic_id": clinic,
            "role": "primary",
            "active": 1,
            "created": db.now(),
        })
        count += 1
    return count


def assignments(pid: str | None = None) -> list[dict]:
    """Assignments joined to the patient and the clinician, newest first."""
    sql = (
        "select a.*, p.name as patient_name, c.name as clinician_name,"
        " k.name as clinic_name from assignments a"
        " left join patients p on p.id = a.patient_id"
        " left join clinicians c on c.id = a.clinician_id"
        " left join clinics k on k.id = a.clinic_id"
    )
    args: tuple = ()
    if pid:
        sql += " where a.patient_id=?"
        args = (pid,)
    sql += " order by a.created desc"
    return [dict(r) for r in db.rows(sql, args)]


def assign(patient_id: str, clinician_id: str, role: str = "covering") -> dict:
    """Add one assignment. The pair is unique, so this is idempotent."""
    if db.patient(patient_id) is None:
        raise KeyError(f"no patient {patient_id}")
    who = db.one("select * from clinicians where id=?", (clinician_id,))
    if who is None:
        raise KeyError(f"no clinician {clinician_id}")
    existing = db.one("select id from assignments where patient_id=? and clinician_id=?",
                      (patient_id, clinician_id))
    aid = str(existing["id"]) if existing else f"as_{patient_id}_{clinician_id}"
    db.put("assignments", {
        "id": aid,
        "patient_id": patient_id,
        "clinician_id": clinician_id,
        "clinic_id": str(who["clinic_id"] or ""),
        "role": role or "covering",
        "active": 1,
        "created": db.now(),
    })
    db.event(patient_id, "assigned", {"clinician_id": clinician_id, "role": role})
    return {"id": aid, "patient_id": patient_id, "clinician_id": clinician_id,
            "clinic_id": str(who["clinic_id"] or ""), "role": role or "covering",
            "active": True}


def unassign(assignment_id: str) -> bool:
    """Deactivate an assignment. The row stays for the audit trail."""
    row = db.one("select id from assignments where id=?", (assignment_id,))
    if row is None:
        return False
    db.patch("assignments", assignment_id, {"active": 0})
    return True


def staff_rows() -> list[dict]:
    """Everyone who can sign in, without password hashes."""
    out = []
    for r in db.rows(
        "select c.id, c.email, c.name, c.role, c.clinic_id, c.last_login, k.name as clinic_name"
        " from clinicians c left join clinics k on k.id = c.clinic_id order by c.name"
    ):
        out.append(dict(r))
    return out
