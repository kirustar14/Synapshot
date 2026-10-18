"""Print what the database actually is, and what it is doing.

    make tiger-check

With no DATABASE_URL this says sqlite and exits 0, because that is a supported mode. With
DATABASE_URL set and no timescaledb extension it exits 1: that is a misconfiguration, not
a fallback.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db, tiger  # noqa: E402


def main() -> int:
    db.conn()
    got = tiger.stats()
    print("")
    print(f"  database        {got['dialect']}")
    print(f"  timescaledb     {got['extension'] or 'not installed'}")
    print(f"  hypertable      {'yes' if got['hypertable'] else 'no'}")
    print(f"  aggregates      {', '.join(got['aggregates']) or 'none'}")
    print(f"  table size      {got['size'] or 'n/a'}")
    print(f"  rows            {got['rows']}")
    if got["latest_bucket"]:
        lag = got["lag_s"]
        print(f"  latest bucket   {got['latest_bucket']}  (lag {lag if lag is not None else '?'} s)")
    comp = got["compression"]
    if comp:
        print(f"  columnstore     {json.dumps(comp, default=str)}")
    else:
        print("  columnstore     no statistics yet (nothing aged into a compressed chunk)")
    if got["policies"]:
        print("  bootstrap")
        for row in got["policies"]:
            print(f"    {row.get('name'):32s} {str(row.get('detail') or '')[:90]}")
    for note in got["notes"]:
        print(f"  note            {note}")

    if db.is_pg():
        bench = tiger.bench(minutes=60, runs=5)
        print("")
        if bench.get("available"):
            print(f"  raw query       {bench['raw_ms']} ms  ({bench['raw_rows']} rows)")
            print(f"  aggregate       {bench['cagg_ms']} ms  ({bench['cagg_rows']} rows)")
            print(f"  speedup         {bench['speedup']}x")
            print(f"  {bench['note']}")
        else:
            print(f"  benchmark       unavailable: {bench.get('reason')}")
        print("")
        if not got["available"]:
            print("  DATABASE_URL is set but timescaledb is missing. Run make tiger.")
            return 1
    else:
        print("")
        print("  sqlite mode: set DATABASE_URL to a Tiger Cloud service for the hypertable,")
        print("  continuous aggregates, columnstore and the measured benchmark.")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
