"""The five steps the Add patient screen shows, in order, as they happen.

`stream()` is a generator of events. The route turns them into server-sent events and the
page draws one line per step. Each step reports what it actually did: how many files were
readable, which extractor ran, how many fields came back, how many need review.

There is a floor on how fast a step can be reported, and it is pacing, not padding. Steps
two to five take real time; steps that finish in 30 ms would flash past unread, and the
point of showing the steps at all is that somebody can see what the system did with their
documents. No step ever claims to have done more than it did.
"""

import time
from pathlib import Path

from .. import db, demo
from ..config import ROOT, cfg
from ..twin import build
from . import apply, extract, read
from .schema import NEEDS_REVIEW, Extraction

FLOOR_S = 0.45

SAMPLE_DIR = ROOT / "backend" / "data" / "sample" / "maya_ortiz"

STEPS = [
    ("read", "Reading the files"),
    ("extract", "Pulling out the facts"),
    ("check", "Checking them against the schema"),
    ("twin", "Building the twin"),
    ("forecast", "Fitting the first forecast"),
]


def sample_files() -> list[tuple[str, bytes]]:
    """The flagship patient's documents off disk, or an empty list if make sample has not run."""
    if not SAMPLE_DIR.exists():
        return []
    return [(n, b) for n, b in read.from_dir(SAMPLE_DIR) if n != "expected.json"]


def expected() -> dict:
    """The answer key for the sample bundle, for the ingest accuracy test."""
    import json

    path = SAMPLE_DIR / "expected.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def store_docs(pid: str, docs: list[read.Doc], files: list[tuple[str, bytes]]) -> list[dict]:
    """Keep the uploaded documents next to the patient and return the input rows.

    The bytes are written before anything is extracted from them, so the quote shown on
    hover can always be checked against the file it claims to come from. A provenance
    trail that points at a file nobody kept is not a provenance trail.
    """
    base = cfg.data_dir / "uploads" / pid
    base.mkdir(parents=True, exist_ok=True)
    by_name = dict(files)
    out = []
    for doc in docs:
        safe = Path(doc.name).name
        if safe:
            (base / safe).write_bytes(by_name.get(doc.name, b""))
        out.append({**doc.summary(), "path": str(base / safe) if safe else ""})
    return out


def conflicts(got: Extraction) -> list[dict]:
    """Fields whose value does not square with another field. Reported, never resolved.

    Two cases worth naming out loud, both of which happen in real charts:
    a CT read as negative next to an MRI finding, which is normal and not a conflict, and
    a GCS of 15 with a stated loss of consciousness, which is worth a clinician's eye.
    """
    out = []
    gcs = apply.used(got, "gcs")
    loc = apply.used(got, "loc_seconds")
    if gcs is not None and loc is not None and float(gcs) >= 15 and float(loc) > 30:
        out.append({"fields": ["gcs", "loc_seconds"],
                    "say": f"GCS {int(gcs)} with {int(loc)} seconds of loss of consciousness. "
                           "Both are as the documents state them."})
    foci = apply.used(got, "swi_foci")
    mri = apply.used(got, "mri_finding")
    if foci is not None and float(foci) > 0 and mri and "swi" not in str(mri).lower() \
            and "suscept" not in str(mri).lower():
        out.append({"fields": ["swi_foci", "mri_finding"],
                    "say": f"{int(foci)} SWI foci were read, but the MRI impression quoted "
                           "does not mention them. Check which report they came from."})
    return out


def create(got: Extraction) -> tuple[str, dict]:
    """Create the patient from the extraction and return its id and what was used.

    Anything the documents did not confidently say keeps the synthetic bundle's value, so
    the twin is always buildable, and `mapped["sources"]` is the record of which fields
    are from a file and which are from the generator.
    """
    mapped = apply.record(got)
    pat = mapped["patient"]
    name = str(pat.get("name") or "Unnamed patient")
    age = int(pat.get("age") or 30)
    sex = str(pat.get("sex") or "F")

    pid = demo.new_patient(name, age, sex)

    row = db.patient(pid)
    injury = {**(db.dec(row["injury"], {}) or {}), **mapped["injury"]}
    alleles = {**(db.dec(row["alleles"], {}) or {}), **mapped["alleles"]}
    bio = {**(db.dec(row["biomarkers"], {}) or {}), **mapped["biomarkers"]}

    chart = {k: v for k, v in pat.items() if k in ("occupation", "medications",
                                                   "reported_symptoms")}
    patch: dict = {"injury": db.enc(injury), "alleles": db.enc(alleles),
                   "biomarkers": db.enc(bio), "chart": db.enc(chart)}
    # Week 0 is the first check-in, not the injury. A patient whose documents are nine days
    # old starts at week 1 so the first forecast is not drawn from the day of the injury.
    gap = injury.get("days_ago")
    if gap is not None:
        patch["week"] = int(min(11, max(0, int(gap) // 7)))
    db.patch("patients", pid, patch)

    db.event(pid, "ingest", {
        "fields": len(got.filled()),
        "needs_review": mapped["unused"],
        "sources": mapped["sources"],
        "extraction": got.model_dump(mode="json"),
    })
    return pid, mapped


def stream(files: list[tuple[str, bytes]]):
    """Run the ingest, yielding one dict per step. The last event is `done`.

    Any step that raises becomes a `failed` event with the reason, rather than a traceback
    into a half-created patient: the patient row is only written in step three, so a
    failure before that leaves nothing behind.
    """
    state: dict = {}
    for key, title in STEPS:
        began = time.monotonic()
        yield {"kind": "step", "step": key, "state": "running", "say": title}
        try:
            detail = _do(key, files, state)
        except Exception as exc:
            yield {"kind": "failed", "step": key, "say": f"{title} failed", "error": str(exc)[:240]}
            return
        left = FLOOR_S - (time.monotonic() - began)
        if left > 0:
            time.sleep(left)
        yield {"kind": "step", "step": key, "state": "done", "say": title, **detail}

    got: Extraction = state["extraction"]
    yield {
        "kind": "done",
        "patient_id": state["pid"],
        "name": db.patient(state["pid"])["name"],
        "fields": len(got.filled()),
        "needs_review": got.needs_review(),
        "threshold": NEEDS_REVIEW,
        "how": state["info"].get("how"),
        "sources": state["mapped"]["sources"],
        "conflicts": state["conflicts"],
        "documents": state["documents"],
    }


def _do(key: str, files: list[tuple[str, bytes]], state: dict) -> dict:
    """One step. Returns what the build log shows next to it."""
    if key == "read":
        docs = read.many(files)
        state["docs"] = docs
        ok = [d for d in docs if d.kind != "none"]
        skipped = [d for d in docs if d.kind == "none"]
        return {"files": len(docs), "readable": len(ok),
                "detail": f"{len(ok)} of {len(docs)} files readable"
                          + (f", {len(skipped)} skipped" if skipped else ""),
                "items": [d.summary() for d in docs]}

    if key == "extract":
        got, info = extract.run(state["docs"])
        state["extraction"], state["info"] = got, info
        how = {"model": f"Claude {info.get('model', '')}".strip(),
               "template": "the built-in extractor",
               "none": "the built-in extractor"}.get(str(info.get("how")), "the extractor")
        why = f". {info['why']}" if info.get("why") else ""
        return {"how": info.get("how"), "fields": len(got.filled()),
                "detail": f"{len(got.filled())} fields read by {how}{why}"}

    if key == "check":
        got: Extraction = state["extraction"]
        state["conflicts"] = conflicts(got)
        low = got.needs_review()
        pid, mapped = create(got)
        state["pid"], state["mapped"] = pid, mapped
        state["documents"] = store_docs(pid, state["docs"], files)
        bits = [f"{len(got.filled())} fields kept"]
        if low:
            bits.append(f"{len(low)} need review")
        if state["conflicts"]:
            bits.append(f"{len(state['conflicts'])} to check")
        return {"needs_review": low, "conflicts": state["conflicts"],
                "detail": ", ".join(bits)}

    if key == "twin":
        got = build.build_twin(state["pid"])
        row = db.patient(state["pid"])
        return {"detail": ("built on the patient's own inputs" if not row["template_only"]
                           else "template only, the documents did not localise an impact"),
                "regions": len(got["twin"]["regions"]) if got.get("twin") else 0}

    if key == "forecast":
        got = build.rebuild_forecast(state["pid"])
        weeks = len(got.get("weeks") or [])
        return {"detail": f"{weeks} weeks with 80 percent bands", "weeks": weeks}

    raise KeyError(key)
