"""The formulary, the pathways, and where a drug's targets sit in this patient's brain.

This is a reference layer, not a prediction layer. It answers "where in the brain does
this medicine act" and never "will this medicine help". The difference matters enough
that the words benefit, effect, recommend and best are filtered out of everything it
returns, and there is no dose guidance anywhere in the data it reads.

What replaced what: the Treatment tab used to run the dynamic mean field model with a
receptor-weighted gain applied to it and show a baseline, a with-drug and a difference.
That simulated a treatment response the model has no standing to predict. It is gone.
See DECISIONS.md.
"""

import json
from functools import lru_cache

import numpy as np

from ..agent import safety
from ..config import ROOT

HERE = ROOT / "backend" / "data"

# A region counts as damaged for the overlap list above this. Fixed rather than a
# percentile, so the same number means the same thing on every patient and two charts
# can be compared.
DAMAGE_FLOOR = 0.15

# And the target has to be denser here than this many standard deviations above the mean
# across regions. One is the conventional "clearly above average" line.
TARGET_Z = 1.0

# Colourblind safe, from the Okabe-Ito and ColorBrewer Dark2 sets. Enough for every drug
# that can be lit at once without two of them reading as the same colour.
COLORS = [
    "#0072b2", "#d55e00", "#009e73", "#cc79a7",
    "#e69f00", "#56b4e9", "#7570b3", "#666666",
]


@lru_cache(maxsize=1)
def formulary() -> dict:
    """The whole formulary file."""
    return json.loads((HERE / "formulary.json").read_text())


@lru_cache(maxsize=1)
def pathways() -> dict:
    """The schematic pathway centrelines."""
    return json.loads((HERE / "pathways.json").read_text())


def drugs() -> list[dict]:
    """Every drug record, in file order."""
    return list(formulary().get("drugs", []))


def drug(name: str) -> dict | None:
    """One drug record by name, case insensitive."""
    want = str(name or "").strip().lower()
    for row in drugs():
        if str(row["name"]).lower() == want:
            return row
    return None


def mapped_keys(row: dict) -> list[str]:
    """The atlas keys this drug actually has a density map for.

    A target with no atlas key is carried through and shown as "no map available". It is
    never quietly swapped for a different receptor that happens to have one.
    """
    out = []
    for t in row.get("targets", []):
        key = t.get("atlas_key")
        if key and key in receptor_maps():
            out.append(key)
    return out


@lru_cache(maxsize=1)
def receptor_maps() -> dict:
    """The Hansen atlas maps, one array of 100 region values per target."""
    from ..twin import intervention

    got = intervention.receptors()
    return (got or {}).get("maps", {}) or {}


def zed(values) -> np.ndarray:
    """Z score across regions, tolerating a flat map."""
    arr = np.asarray(values, dtype=float)
    sd = float(np.nanstd(arr))
    return (arr - float(np.nanmean(arr))) / (sd if sd > 1e-9 else 1.0)


def density(name: str) -> dict:
    """Per target z scored density for one drug, plus the mean across its targets.

    Returns {"targets": {key: [100 floats]}, "combined": [100 floats], "pathways": [...]}.
    A drug with no mapped target returns empty arrays and says so rather than returning
    a map belonging to something else.
    """
    row = drug(name)
    if row is None:
        return {}
    maps = receptor_maps()
    per = {}
    for key in mapped_keys(row):
        per[key] = [round(float(v), 4) for v in zed(maps[key])]
    combined = []
    if per:
        combined = [round(float(v), 4) for v in np.mean([per[k] for k in per], axis=0)]
    return {
        "name": row["name"],
        "targets": per,
        "combined": combined,
        "pathways": list(row.get("pathways", [])),
        "no_mapped_target": row.get("no_mapped_target") or ("" if per else
                                                            "No map available for this drug's targets."),
    }


def region_names(pid: str) -> list[dict]:
    """Full Schaefer name and network per region, in region order.

    The full name every time. "Left cortex" on its own is shared by a dozen parcels and
    a row that says it is not telling a clinician which part of the brain is meant.
    """
    from ..app import inputs_of

    twin = inputs_of(pid).get("twin") or {}
    out = []
    for r in twin.get("regions", []):
        out.append({"id": int(r["id"]), "name": str(r["name"]),
                    "network": str(r.get("network") or "")})
    return out


def overlap(pid: str, name: str, week: int | None = None) -> dict:
    """Regions that are both damaged in this patient and dense in this drug's targets.

    Damaged above DAMAGE_FLOOR and target density above TARGET_Z. An intersection of two
    facts, nothing more: it does not say the drug will reach those regions, and it does
    not say anything would improve if it did. Empty is a real and common answer.
    """
    row = drug(name)
    if row is None:
        return {}
    from ..app import inputs_of

    twin = inputs_of(pid).get("twin") or {}
    regions = twin.get("regions", [])
    got = density(name)
    combined = got.get("combined") or []
    if not regions or not combined:
        return {"name": row["name"], "regions": [], "damage_floor": DAMAGE_FLOOR,
                "target_z": TARGET_Z,
                "note": got.get("no_mapped_target") or "No mapped brain target for this drug."}

    at = int(week if week is not None else 0)
    out = []
    for r in regions:
        rid = int(r["id"])
        if rid >= len(combined):
            continue
        series = r.get("damage") or [0.0]
        idx = min(max(at, 0), len(series) - 1)
        dmg = float(series[idx])
        z = float(combined[rid])
        if dmg <= DAMAGE_FLOOR or z <= TARGET_Z:
            continue
        lo = (r.get("damage_lo") or series)[idx]
        hi = (r.get("damage_hi") or series)[idx]
        out.append({
            "id": rid,
            "name": str(r["name"]),
            "network": str(r.get("network") or ""),
            "damage": round(dmg, 4),
            "damage_lo": round(float(lo), 4),
            "damage_hi": round(float(hi), 4),
            "target_z": round(z, 3),
        })
    out.sort(key=lambda r: r["target_z"], reverse=True)
    return {"name": row["name"], "week": at, "regions": out,
            "damage_floor": DAMAGE_FLOOR, "target_z": TARGET_Z,
            "note": "Regions that are both damaged in this patient and dense in this "
                    "drug's known targets. An overlap of two maps, not a prediction."}


def clean_record(row: dict) -> dict:
    """One drug record with every displayed string through the banned phrase filter."""
    def scrub(val):
        if isinstance(val, str):
            return safety.clean(val)
        if isinstance(val, list):
            return [scrub(v) for v in val]
        if isinstance(val, dict):
            return {k: scrub(v) for k, v in val.items()}
        return val

    out = scrub(dict(row))
    out["mapped_targets"] = mapped_keys(row)
    out["has_map"] = bool(out["mapped_targets"])
    return out


def listing() -> dict:
    """Every drug, with a stable colour per drug for the brain legend."""
    rows = []
    for i, row in enumerate(drugs()):
        got = clean_record(row)
        got["color"] = COLORS[i % len(COLORS)]
        rows.append(got)
    return {"drugs": rows, "sources": formulary().get("_sources", {}),
            "note": "Where each medicine's known targets and pathways are in the brain. "
                    "It is not a prediction about how a medicine would work for anyone."}
