"""Before and after a check-in, in numbers. Run with `make call-report`.

The question this answers is the one a demo cannot answer by itself: when a patient
finishes a check-in, does the brain on the screen actually change, and by how much.

It reads the twin, the recovery parameters and the open flags, runs one generated call
all the way through `finish`, which is the same code a real phone drives, then reads
everything again and prints the difference. No part of it is simulated separately: the
measurements come out of the feature pipeline, the parameters out of the filter.

    python -m scripts.call_update_report                 one typical call
    python -m scripts.call_update_report --degrade 0.5   a worse week
    python -m scripts.call_update_report --degrade -0.4  a better week
    python -m scripts.call_update_report --patient <id>
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import db  # noqa: E402
from backend.calls import run as callrun  # noqa: E402
from backend.calls import sessions  # noqa: E402

# A region has to move by more than this to be counted as having moved at all. It is the
# same number the report prints a count against, chosen because the filter's own week to
# week wobble on an unchanged region sits below it.
MOVED = 0.01


def twin_of(pid: str) -> dict:
    """The twin as the workspace reads it: stored if it is there, built if it is not."""
    from backend.app import inputs_of
    from backend.twin import build

    got = inputs_of(pid).get("twin")
    return got or build.build_twin(pid)["twin"]


def regions_now(pid: str, week: int) -> dict[int, float]:
    """Damage at the week being looked at, for every region, by region id.

    The week matters. Index 0 is the injury, which barely moves whatever the filter
    learns, so comparing week 0 before and after would report no change on a call that
    moved the whole recovery curve.
    """
    twin = twin_of(pid)
    out = {}
    for r in twin["regions"]:
        series = r.get("damage") or [0.0]
        at = min(max(week, 0), len(series) - 1)
        out[int(r["id"])] = float(series[at])
    return out


def names(pid: str) -> dict[int, tuple[str, str]]:
    """Full readable region name and network, by region id.

    The full name, never "left cortex" on its own: two different parcels share that and
    a report that cannot tell them apart is not a report.
    """
    twin = twin_of(pid)
    return {int(r["id"]): (str(r["name"]), str(r.get("network") or "")) for r in twin["regions"]}


def params_now(pid: str) -> dict:
    """k and p with their intervals, from the most recent filter update.

    The posterior summaries live under `post` in the stored payload, not at the top of
    it: the top level is the twin's own parameters, which do not carry the intervals.
    """
    row = db.latest_params(pid)
    got = db.dec(row["payload"], {}) if row else {}
    post = got.get("post") or {}
    return {
        "k": post.get("k"),
        "k_lo": post.get("k_lo"),
        "k_hi": post.get("k_hi"),
        "p": post.get("p"),
        "week": int(row["week"]) if row else None,
    }


def flags_now(pid: str) -> set[str]:
    """Open flag types for this patient."""
    return {str(a["type"]) for a in db.alerts(pid) if not int(a["acked"] or 0)}


def snapshot(pid: str, week: int | None = None) -> dict:
    """Everything the report compares, read in one go."""
    row = db.patient(pid)
    at = int(row["week"] or 0) if week is None else week
    return {
        "damage": regions_now(pid, at),
        "params": params_now(pid),
        "drift_z": round(float(row["drift_z"] or 0.0), 3) if row else 0.0,
        "flags": flags_now(pid),
        "week": int(row["week"] or 0) if row else 0,
    }


def run_call(pid: str, degrade: float) -> dict:
    """One generated call, all the way through finish."""
    start = sessions.create(pid)
    return callrun.mock_call(start["token"], degrade=degrade)


def fmt(val, places: int = 4) -> str:
    """A number, or a dash when there is not one."""
    return "-" if val is None else f"{float(val):.{places}f}"


def report(pid: str, degrade: float) -> dict:
    """Run the call and print the before and after. Returns the numbers."""
    pat = db.patient(pid)
    label = str(pat["name"]) if pat else pid
    # The old twin is held in memory so the comparison can be made at one week. The call
    # advances the patient's week, and reading before at the old week and after at the
    # new one would mix up the week moving with the model changing, which are different
    # claims and only the second one is the one being made here.
    old_twin = twin_of(pid)
    before = snapshot(pid)

    got = run_call(pid, degrade)
    if not got.get("ok"):
        print(f"\n  the call did not finish: {got.get('error')}\n")
        return {"ok": False}

    after = snapshot(pid)
    week = after["week"]
    before["damage"] = {
        int(r["id"]): float((r.get("damage") or [0.0])[min(week, len(r.get("damage") or [0.0]) - 1)])
        for r in old_twin["regions"]
    }
    after["damage"] = regions_now(pid, week)
    tag = "typical" if degrade == 0 else ("worse" if degrade > 0 else "better")

    moves = []
    for rid, was in before["damage"].items():
        now = after["damage"].get(rid, was)
        moves.append((abs(now - was), rid, was, now))
    moves.sort(reverse=True)
    moved = [m for m in moves if m[0] > MOVED]
    label_of = names(pid)

    print("")
    print(f"  {label}, week {before['week']} to {after['week']}, "
          f"compared at week {week}, {tag} call")
    print("  " + "=" * 74)
    print("")
    print(f"  regions that moved by more than {MOVED}   {len(moved)} of {len(moves)}")
    print(f"  largest move in any one region            {fmt(moves[0][0] if moves else 0)}")
    print(f"  mean move across every region             "
          f"{fmt(sum(m[0] for m in moves) / len(moves) if moves else 0)}")
    print("")
    print("  the five that moved most")
    for size, rid, was, now in moves[:5]:
        name, net = label_of.get(rid, (f"region {rid}", ""))
        arrow = "worse" if now > was else "better"
        print(f"    {name[:44]:44s} {net[:12]:12s} {was:.4f} -> {now:.4f}  {size:+.4f} {arrow}")
    print("")
    print("  recovery parameters")
    pb, pa = before["params"], after["params"]
    print(f"    k      {fmt(pb['k'])} [{fmt(pb['k_lo'])}, {fmt(pb['k_hi'])}]"
          f"   ->   {fmt(pa['k'])} [{fmt(pa['k_lo'])}, {fmt(pa['k_hi'])}]")
    print(f"    p      {fmt(pb['p'])}                      ->   {fmt(pa['p'])}")
    print("")
    print(f"  drift z  {before['drift_z']:+.3f}  ->  {after['drift_z']:+.3f}")
    added = sorted(after["flags"] - before["flags"])
    gone = sorted(before["flags"] - after["flags"])
    print(f"  flags    {sorted(before['flags']) or 'none'}  ->  {sorted(after['flags']) or 'none'}")
    if added:
        print(f"           new: {', '.join(added)}")
    if gone:
        print(f"           cleared: {', '.join(gone)}")
    print("")

    return {
        "ok": True,
        "moved": len(moved),
        "total": len(moves),
        "max_move": moves[0][0] if moves else 0.0,
        "mean_move": sum(m[0] for m in moves) / len(moves) if moves else 0.0,
        "flags_added": added,
        "drift_before": before["drift_z"],
        "drift_after": after["drift_z"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--patient", default="", help="patient id, default the first seeded one")
    ap.add_argument("--degrade", type=float, default=0.0,
                    help="how much worse to make the week. 0 is typical, "
                         "positive is worse, negative is better")
    args = ap.parse_args()

    db.conn()
    pats = db.patients()
    if not pats:
        print("\n  no patients. Run make seed first.\n")
        return 1
    pid = args.patient or str(pats[0]["id"])
    got = report(pid, args.degrade)
    return 0 if got.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
