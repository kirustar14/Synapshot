"""Does a check-in replace the patient instead of adding to them?

The report was that after a call the flagship patient looked worse and thinner: the
original baseline brain, history, charts, flags and key facts appeared to have been
replaced rather than updated.

This resets the demo patient, snapshots everything about them, runs one generated call
all the way through the real pipeline, snapshots again, and prints a field by field diff
of what changed, what was added and what was lost.

    python -m scripts.reproduce_call_wipe
    python -m scripts.reproduce_call_wipe --patient <id>    skip the reset
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import db  # noqa: E402
from backend.calls import run as callrun  # noqa: E402
from backend.calls import sessions  # noqa: E402

# Fields on the patient row that describe who the patient is, as opposed to what the
# model currently believes. None of these should move because of a check-in.
IDENTITY = ["name", "age", "sex", "injury", "alleles", "biomarkers", "chart",
            "template_only", "d0", "seed"]

# Fields a check-in is allowed to move. The filter learning is the point of a call.
EXPECTED = ["week", "drift_z", "coverage", "state", "params", "contraction", "last_call"]


def digest(value) -> str:
    """A stable short hash of any JSON-able value, for comparing big blobs."""
    raw = json.dumps(value, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()[:12]


def twin_of(pid: str) -> dict:
    row = db.twin_inputs(pid)
    return (db.dec(row["payload"], {}) or {}) if row is not None else {}


def snapshot(pid: str) -> dict:
    """Everything about a patient that a demo would notice losing."""
    row = db.patient(pid)
    bundle = twin_of(pid)
    twin = bundle.get("twin") or {}

    regions = {}
    for r in twin.get("regions", []):
        regions[int(r["id"])] = {
            "name": r["name"],
            "network": r.get("network"),
            "damage": [round(float(v), 5) for v in (r.get("damage") or [])],
        }

    return {
        "identity": {k: digest(db.dec(row[k], row[k]) if k in
                               ("injury", "alleles", "biomarkers", "chart") else row[k])
                     for k in IDENTITY},
        "identity_raw": {k: (db.dec(row[k], None) if k in
                             ("injury", "alleles", "biomarkers", "chart") else row[k])
                         for k in IDENTITY},
        "moving": {k: digest(row[k]) for k in EXPECTED},
        "week": int(row["week"] or 0),
        "regions": regions,
        "region_count": len(regions),
        "twin_inputs_keys": sorted(bundle.keys()),
        "inputs": [i.get("file") for i in bundle.get("inputs", [])],
        "sources": digest(bundle.get("sources")),
        "fc_fit": bundle.get("fc_fit"),
        "checkins": [dict(r)["week"] for r in db.rows(
            "select week from checkins where patient_id=? order by week", (pid,))],
        "observations": [o["week"] for o in db.observations(pid)],
        "alerts": sorted(f"{a['type']}@{a['time']}" for a in db.alerts(pid)),
        "alert_types": sorted({a["type"] for a in db.alerts(pid)}),
        "events": sorted(f"{e['kind']}" for e in db.rows(
            "select kind from events where patient_id=?", (pid,))),
        "uploads": sorted(u["name"] for u in db.uploads(pid)) if db.uploads(pid) else [],
        "forecasts": len(db.rows("select id from forecasts where patient_id=?", (pid,))),
        "parameters": len(db.rows("select id from parameters where patient_id=?", (pid,))),
    }


def show(before: dict, after: dict) -> int:
    """Print the diff. Returns the number of things that look like a loss."""
    lost = 0

    print("\n  IDENTITY, which a call must never touch")
    print("  " + "-" * 72)
    for key in IDENTITY:
        was, now = before["identity"][key], after["identity"][key]
        mark = "same" if was == now else "CHANGED"
        if was != now:
            lost += 1
        print(f"    {key:16s} {mark}")
        if was != now:
            print(f"      before: {str(before['identity_raw'][key])[:90]}")
            print(f"      after : {str(after['identity_raw'][key])[:90]}")

    print("\n  THE BRAIN")
    print("  " + "-" * 72)
    print(f"    regions           {before['region_count']} -> {after['region_count']}")
    if after["region_count"] < before["region_count"]:
        lost += 1
        print("      REGIONS LOST")
    gone = [rid for rid in before["regions"] if rid not in after["regions"]]
    if gone:
        lost += 1
        print(f"      {len(gone)} region ids disappeared")
    # The week a region's damage array covers. Losing weeks is losing history.
    bw = len(next(iter(before["regions"].values()), {}).get("damage", []))
    aw = len(next(iter(after["regions"].values()), {}).get("damage", []))
    print(f"    weeks per region  {bw} -> {aw}")
    if aw < bw:
        lost += 1
        print("      WEEKS LOST from the damage series")

    moved = sum(1 for rid, r in after["regions"].items()
                if rid in before["regions"] and r["damage"] != before["regions"][rid]["damage"])
    print(f"    regions whose damage series changed   {moved}")

    print("\n  HISTORY, which should only ever grow")
    print("  " + "-" * 72)
    for key in ("checkins", "observations", "alerts", "events", "uploads"):
        was, now = before[key], after[key]
        missing = [x for x in was if x not in now]
        added = [x for x in now if x not in was]
        mark = "ok" if not missing else "LOST"
        if missing:
            lost += 1
        print(f"    {key:16s} {len(was)} -> {len(now)}  {mark}")
        if missing:
            print(f"      lost: {missing[:6]}")
        if added:
            print(f"      added: {added[:6]}")

    for key in ("forecasts", "parameters"):
        print(f"    {key:16s} {before[key]} -> {after[key]}")

    print("\n  THE TWIN BUNDLE, which carries the documents and the sources")
    print("  " + "-" * 72)
    for key in ("twin_inputs_keys", "inputs", "sources", "fc_fit"):
        was, now = before[key], after[key]
        mark = "same" if was == now else "CHANGED"
        if was != now:
            lost += 1
        print(f"    {key:18s} {mark}")
        if was != now:
            print(f"      before: {str(was)[:90]}")
            print(f"      after : {str(now)[:90]}")

    print("\n  EXPECTED TO MOVE (a call is supposed to change these)")
    print("  " + "-" * 72)
    for key in EXPECTED:
        same = before["moving"][key] == after["moving"][key]
        print(f"    {key:16s} {'unchanged' if same else 'updated'}")

    return lost


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--patient", default="")
    ap.add_argument("--no-reset", action="store_true")
    args = ap.parse_args()

    db.conn()
    if not args.patient and not args.no_reset:
        from backend import demo

        print("\n  resetting the demo patients ...")
        demo.reset(quiet=True)

    pats = db.patients()
    if not pats:
        print("\n  no patients. Run make seed.\n")
        return 1
    # The flagship one if it is there, otherwise the first.
    pid = args.patient or next(
        (str(p["id"]) for p in pats if "maya" in str(p["name"]).lower()), str(pats[0]["id"]))
    name = str(db.patient(pid)["name"])

    print(f"\n  {name}  ({pid})")
    before = snapshot(pid)

    print("  running one generated call through the real pipeline ...")
    got = callrun.mock_call(sessions.create(pid)["token"], degrade=1.0)
    if not got.get("ok"):
        print(f"\n  the call did not finish: {got.get('error')}\n")
        return 1

    after = snapshot(pid)
    print("\n" + "=" * 76)
    lost = show(before, after)
    print("\n" + "=" * 76)
    if lost:
        print(f"  {lost} thing(s) look like a loss. A call should only ever add.\n")
    else:
        print("  nothing was lost. The call added a timepoint and left the rest alone.\n")
    return 1 if lost else 0


if __name__ == "__main__":
    raise SystemExit(main())
