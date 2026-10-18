# Tiger Data setup

The click-by-click path from a fresh checkout to a live Tiger Cloud service. It is written for the code in
this repo, not as generic platform documentation.

| Piece | What it does here |
| --- | --- |
| **Tiger Cloud** (managed Postgres with TimescaleDB) | The system of record for the clinic, and the time-series store for the 5 Hz call telemetry: a hypertable, two continuous aggregates and the columnstore. |

No real patient data goes into it. Everything is synthetic.

**It is optional.** With `DATABASE_URL` empty, SQLite is the system of record and everything still works.
If `DATABASE_URL` is set but Tiger cannot be reached (a network that blocks the port, a paused service),
the app starts on SQLite anyway and says so in `/api/pulse` and in the log. It never takes the app down.

**Cost and time:** Tiger is a 30-day, $1,000 trial with no card.

---

## 0. Before you start

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

On Windows, use `.venv/Scripts/python.exe` wherever this guide says `.venv/bin/python`.

You need a Tiger Cloud account: <https://console.cloud.tigerdata.com/signup>

**Network:** Tiger listens on a non-standard port. Some venue and campus Wi-Fi blocks those, and the
connection simply times out. A phone hotspot is the usual fix.

---
## 1. Tiger Cloud

### 1.1 Create the service

1. Sign in at <https://console.cloud.tigerdata.com/>. The trial gives $1,000 of credit for 30
   days, no credit card.
2. Click **New service**. Pick the cloud and region closest to you (AWS `us-east-1` is the
   safe default for a demo), the smallest Performance shape that fits the trial, and name it
   `synapshot`. Create it.
3. When it is ready, open **Download your database config** and download the file. **The
   password is shown once.** If you lose it, reset it from the service's settings; there is
   no way to read it back.

The connection string in that file looks like:

```
postgres://tsdbadmin:<password>@<service>.<project>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require
```

Keep `sslmode=require`. The service rejects plaintext connections.

### 1.2 Point the app at it

Put the URI in `.env` at the repo root:

```sh
DATABASE_URL=postgres://tsdbadmin:...@...:.../tsdb?sslmode=require
```

`.env` is ignored by git. Do not paste the URI into a commit, a screenshot, or a chat.

Install the Postgres driver in the venv (it is in `requirements.txt`, but confirm):

```sh
.venv/bin/python -m pip install "psycopg[binary,pool]"
# Windows: .venv/Scripts/python.exe -m pip install "psycopg[binary,pool]"
```

Test the raw connection before involving the app. This catches a wrong password or a
missing `sslmode` in ten seconds:

```sh
.venv/bin/python - <<'PY'
import psycopg
from backend.config import cfg

with psycopg.connect(cfg.database_url) as c:
    print(c.execute("select current_database(), current_user, version()").fetchone())
PY
```

`backend.config` loads `.env` itself, so this uses the same URI the app will. The app opens
at most four pooled connections, which is well inside a small service's limit.

### 1.3 Bootstrap the time-series schema

`backend/tiger.py` is idempotent. It creates the extension if the role is allowed, converts
`metric_samples` into a hypertable, creates `metrics_1m` and `metrics_1h`, adds refresh
policies, and adds a columnstore policy. Each step is recorded in `tiger_bootstrap`, so a
second run skips what already exists.

```sh
.venv/bin/python -c "from backend import db, tiger; db.conn(); print(tiger.bootstrap())"
.venv/bin/python scripts/tiger_check.py
```

Read the output, not just the exit code. A healthy fresh service says `ok: true`, an
extension version, a hypertable, two continuous aggregates, and a columnstore or a note
explaining why this service could not enable it. Older TimescaleDB builds legitimately fall
back to compression instead of columnstore; `tiger_check` says which one you got.

Equivalent SQL in the Tiger Console SQL editor if you want to see it yourself:

```sql
select extversion from pg_extension where extname = 'timescaledb';

select hypertable_name, num_chunks
from timescaledb_information.hypertables;

select view_name, materialized_only
from timescaledb_information.continuous_aggregates;

select * from hypertable_columnstore_stats('metric_samples');

select count(*) from metric_samples;
```

### 1.4 Put data in it

`backend.seed` creates the clinics, the four staff accounts, the cohort, and the demo
patients. On a **brand new** service this is safe. `backend.demo.reset()` wipes tables, so
never run it against a database that has data you care about.

```sh
OFFLINE=1 .venv/bin/python -m backend.seed
OFFLINE=1 .venv/bin/python -c "from backend import demo; print(demo.reset(quiet=True))"
```

Then generate telemetry and exercise the write path:

```sh
.venv/bin/python scripts/tiger_load.py --rows 300000 --compress
.venv/bin/python scripts/tiger_check.py
```

`--compress` matters for the demo: the columnstore policy only converts chunks older than a
day, so a 300k-row load from five minutes ago is still in rowstore until you force it. The
check then prints the compression ratio and the raw-versus-aggregate latency.

### 1.5 Run it and look at it

```sh
OFFLINE=1 .venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
curl -s 'localhost:8000/api/pulse?minutes=60'
curl -s 'localhost:8000/api/pulse?bench=1'
```

`/api/pulse` returns `source: "continuous aggregate"` when it answered from `metrics_1m`, or
`source: "raw"` with a reason while the aggregate is empty or unavailable, or `source: "sqlite"` with a
`fallback` reason when `DATABASE_URL` is set but Tiger could not be reached. `bench=1` is opt in and reports
the measured raw-versus-aggregate timings, so a page load is never a load test.

### 1.6 Optional: the live Postgres test

`tests/test_tiger_pg.py` is skipped unless `TEST_DATABASE_URL` is set. It creates a scratch
schema, exercises the driver and the hypertable path, then drops the schema:

```sh
TEST_DATABASE_URL="$DATABASE_URL" .venv/bin/python -m pytest -q tests/test_tiger_pg.py -s
```

If the service role cannot create a schema, run this against a disposable database instead
of weakening the test.

### Tiger pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `psycopg is not installed` | Driver missing from the venv | `pip install "psycopg[binary,pool]"` |
| `connection requires a valid client certificate` / SSL error | `sslmode` stripped from the URI | Add `?sslmode=require` |
| TCP timeout to the service host, but the Tiger SQL Editor works | A corporate or campus network is blocking the database port (often only 443 is allowed) | Use a phone hotspot, a cloud VM, or ask the network owner to allow outbound TCP to the assigned port |
| Password rejected | The config password was never saved and cannot be re-read | Reset it in the console, update `.env` |
| `tiger_check` says no extension | Connected to a plain Postgres, not the Tiger service | Check the host in `DATABASE_URL` |
| `source: "raw"` on pulse | No aggregate bucket refreshed yet | Wait for the refresh policy, or read `notes` in `tiger_check` |
| No compression in the demo | Columnstore policy is 1 day old by design | `tiger_load.py --compress` before showing the ratio |
| Trial expired | 30 days from signup | Export or upgrade; do not leave demo data there |

---

---

## What to show in three minutes

1. **The live feed.** Open a check-in on the phone page; the call posts about five times a second.
2. **Tiger.** `make tiger-check` on screen: the hypertable, two aggregates, the compression ratio, and the
   raw-versus-aggregate timing from `/api/pulse?bench=1`.
3. **The fallback.** Unset `DATABASE_URL` and restart: the same app runs on SQLite and says so.
