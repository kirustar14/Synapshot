"""Fill the telemetry table and measure what the database does with it.

    python scripts/tiger_load.py --rows 300000
    python scripts/tiger_load.py --rows 300000 --compress

The numbers printed are measured on the service in DATABASE_URL, or on local sqlite when
it is empty. Nothing here reports an estimate as a measurement.
"""

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db, tiger  # noqa: E402

METRICS = {
    "fps": (30.0, 1.2),
    "face": (0.94, 0.04),
    "dist": (0.97, 0.02),
    "light": (0.9, 0.08),
    "gaze_err": (0.06, 0.02),
    "pursuit_gain": (0.78, 0.06),
    "frames": (30.0, 4.0),
}


def _stamp(moment: datetime):
    return moment if db.is_pg() else moment.strftime("%Y-%m-%dT%H:%M:%S.%f")


def build(rows: int, patients: int, minutes: int, seed: int = 7) -> list[tuple]:
    """Rows spread evenly over the window, one value per metric per patient per tick."""
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    span = min(max(1, minutes), 60 * 24 * 7)
    out = []
    names = list(METRICS)
    per_tick = max(1, patients * len(names))
    ticks = max(1, rows // per_tick)
    for i in range(ticks):
        moment = now - timedelta(minutes=span) + timedelta(minutes=span * i / ticks)
        for p in range(patients):
            pid = f"pat_load_{p:02d}"
            token = f"load_{p:02d}"
            for name in names:
                mean, sd = METRICS[name]
                value = max(0.0, rng.gauss(mean, sd))
                out.append((_stamp(moment), pid, token, name, value, 1.0))
    return out


def _refresh() -> str:
    if not db.is_pg():
        return "sqlite has no continuous aggregate to refresh"
    try:
        # Autocommit: TimescaleDB refuses refresh_continuous_aggregate inside a transaction.
        db.autocommit("call refresh_continuous_aggregate('metrics_1m', now() - interval '2 days', now())")
        return "metrics_1m refreshed"
    except Exception as exc:  # noqa: BLE001
        return f"refresh failed: {exc}"


def _compress() -> str:
    """Convert what exists now, so the demo has a ratio instead of a promise."""
    if not db.is_pg():
        return "sqlite has no columnstore"
    try:
        db.run("call convert_to_columnstore('metric_samples')")
        return "converted the existing chunks to the columnstore"
    except Exception:
        pass
    try:
        rows = db.rows("select show_chunks('metric_samples') as chunk")
        for row in rows:
            chunk = row["chunk"] if isinstance(row, dict) else row[0]
            db.run("select compress_chunk(?)", (str(chunk),))
        return f"legacy compress_chunk on {len(rows)} chunks"
    except Exception as exc:  # noqa: BLE001
        return f"compression not available on this service: {exc}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rows", type=int, default=300_000)
    ap.add_argument("--patients", type=int, default=12)
    ap.add_argument("--minutes", type=int, default=180, help="spread the rows over this window")
    ap.add_argument("--batch", type=int, default=5000)
    ap.add_argument("--compress", action="store_true", help="convert existing chunks now")
    args = ap.parse_args()

    db.conn()
    print(f"  database {db.dialect()}")
    before = db.count("select count(*) as c from metric_samples")
    t0 = time.perf_counter()
    made = build(max(1, args.rows), max(1, args.patients), args.minutes)
    for start in range(0, len(made), max(1, args.batch)):
        db.metric_insert(made[start:start + max(1, args.batch)])
    secs = max(time.perf_counter() - t0, 1e-9)
    after = db.count("select count(*) as c from metric_samples")

    print(f"  inserted      {len(made):,} rows in {secs:.2f} s  ({len(made) / secs:,.0f} rows/s)")
    print(f"  table rows    {after:,} (was {before:,})")
    print(f"  {_refresh()}")

    if args.compress:
        print(f"  {_compress()}")

    stats = tiger.stats()
    print(f"  size          {stats['size'] or 'n/a'}")
    if stats["compression"]:
        print(f"  columnstore   {stats['compression']}")
    for note in stats["notes"]:
        print(f"  note          {note}")

    if db.is_pg():
        bench = tiger.bench(minutes=min(args.minutes, 1440), runs=5)
        if bench.get("available"):
            print(f"  raw / cagg    {bench['raw_ms']} ms / {bench['cagg_ms']} ms"
                  f"  ({bench['speedup']}x, median of {bench['runs']})")
        else:
            print(f"  benchmark     unavailable: {bench.get('reason')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
