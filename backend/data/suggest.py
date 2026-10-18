"""Medicines commonly considered for the symptoms a patient actually reported.

Not a ranking, and deliberately not one. The order is how many of this patient's elevated
symptoms a medicine is commonly used for, which is a count of matches and nothing else. It
is not a judgement about which is better, because nothing here can know that: there is no
outcome model behind it, only the ordinary association between a symptom and a class of
medicine. The words recommend and best never appear, and nor does a dose.

The point of it is narrower than it looks. A clinician opening the Treatment tab has a
formulary of twelve medicines and a patient with four elevated symptoms, and this puts
the ones worth reading first at the top instead of leaving them to scroll.
"""

import json
from functools import lru_cache

from ..agent import safety
from .. import db
from . import drugs as drugmod
from ..config import ROOT

HERE = ROOT / "backend" / "data"


@lru_cache(maxsize=1)
def table() -> dict:
    """The symptom to medicine map."""
    return json.loads((HERE / "symptom_map.json").read_text())


def threshold() -> float:
    """The score out of ten at or above which a symptom counts as reported."""
    return float(table().get("threshold", 4))


def latest_scores(pid: str) -> dict:
    """The most recent per symptom scores for a patient, or an empty dict.

    They live on the call session rather than the check-in: the check-in keeps
    `symptom_total` because that is what the filter assimilates, and the individual
    scores are only needed here and on the Data tab.
    """
    # The call tables are created the first time a call is made, not when the database
    # is. On a fresh install nobody has called anybody, so this query is against a table
    # that does not exist yet and raises. An empty result is the right answer there, and
    # the route 500ing on a brand new patient is not.
    from ..calls import sessions

    try:
        sessions.setup()
        rows = db.rows("select * from call_sessions where patient_id=? and state='done' "
                       "order by week desc, created desc limit 1", (pid,))
    except Exception:
        return {}
    if not rows:
        return {}
    got = db.dec(rows[0]["symptoms"], {}) or {}
    inner = got.get("symptoms") or {}
    return {str(k): float(v) for k, v in inner.items() if v is not None}


def elevated(scores: dict) -> dict:
    """The symptoms at or above the threshold, mapped onto the symptom map's own keys.

    Several of the collected symptoms are different words for the same thing as far as
    what gets prescribed is concerned: pressure and neck pain travel with headache, and
    blurred vision travels with light sensitivity. The aliases fold them together so one
    medicine is not listed three times for what is really one complaint.
    """
    aliases = table().get("_aliases", {})
    known = table().get("symptoms", {})
    bar = threshold()
    out: dict[str, list[str]] = {}
    for key, score in scores.items():
        if score < bar:
            continue
        mapped = aliases.get(key, key)
        if mapped not in known:
            continue
        out.setdefault(mapped, []).append(key)
    return out


def current_meds(pid: str) -> set[str]:
    """Medicines the chart already lists for this patient, lower cased."""
    row = db.patient(pid)
    chart = db.dec(row["chart"], {}) if row is not None else {}
    out = set()
    for med in (chart or {}).get("medications", []) or []:
        name = str(med.get("name") or "").strip().lower()
        if name:
            out.add(name)
    return out


def suggested(pid: str) -> dict:
    """Medicines commonly used for this patient's elevated symptoms, most matches first."""
    scores = latest_scores(pid)
    hits = elevated(scores)
    bar = threshold()

    if not scores:
        return {"drugs": [], "threshold": bar, "symptoms": [],
                "message": "No check-in with symptom scores yet, so there is nothing to match against.",
                "note": TOOLTIP}
    if not hits:
        return {"drugs": [], "threshold": bar, "symptoms": [],
                "message": f"No symptom is at {bar:.0f} or above this week, so nothing is listed here.",
                "note": TOOLTIP}

    known = table().get("symptoms", {})
    taking = current_meds(pid)
    by_drug: dict[str, dict] = {}
    for sym, raw_keys in hits.items():
        entry = known[sym]
        for row in entry.get("drugs", []):
            name = str(row["name"])
            if drugmod.drug(name) is None:
                continue
            got = by_drug.setdefault(name, {
                "name": name,
                "matched_symptoms": [],
                "reasons": [],
                "source": row.get("source", ""),
                "evidence_tag": row.get("evidence_tag", "check this"),
                "current": name in taking,
            })
            got["matched_symptoms"].append(entry["label"].lower())
            got["reasons"].append(str(row.get("why", "")))
            # The weakest tag on any row wins, so one unverified association is not
            # hidden behind a verified one on the same medicine.
            if row.get("evidence_tag") == "check this":
                got["evidence_tag"] = "check this"

    rows = []
    for got in by_drug.values():
        record = drugmod.drug(got["name"]) or {}
        rows.append({
            "name": got["name"],
            "class": str(record.get("class", "")),
            "matched_symptoms": got["matched_symptoms"],
            "match_count": len(got["matched_symptoms"]),
            "reason": safety.clean(", ".join(got["matched_symptoms"])),
            "why": safety.clean(got["reasons"][0] if got["reasons"] else ""),
            "source": got["source"],
            "evidence_tag": got["evidence_tag"],
            "current": got["current"],
            "has_map": bool(drugmod.mapped_keys(record)),
        })
    # Most matched symptoms first, then alphabetically so the order is stable between
    # loads. Not a ranking of which is better: a count of how many of this patient's
    # symptoms each one is ordinarily used for.
    rows.sort(key=lambda r: (-r["match_count"], r["name"]))

    return {
        "drugs": rows,
        "threshold": bar,
        "symptoms": sorted(known[s]["label"] for s in hits),
        "message": "",
        "note": TOOLTIP,
        "sources": table().get("_sources", {}),
    }


TOOLTIP = "Based on usual use for the symptoms reported, for clinician review."
