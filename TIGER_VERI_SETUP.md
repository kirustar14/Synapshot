# Tiger Cloud and Veri setup

This is the click-by-click path from a fresh checkout to a live Tiger Cloud service and a
trained, deployed decision model on Veri. It is written for the code in this repo, not as
generic platform documentation.

Two separate services, two separate jobs:

| Piece | What it is | What it does here |
| --- | --- | --- |
| **Tiger Cloud** | Managed Postgres with TimescaleDB | System of record for the clinic, and the time-series store for the 5 Hz call telemetry. Hypertable, two continuous aggregates, columnstore. |
| **Veri** | GPU training and inference platform | SFT then GRPO on Qwen2.5-0.5B-Instruct, merged LoRA weights on Hugging Face, OpenAI-compatible deployment that `backend/agent/adaptive.py` calls. |
| **Jev** | TypeSafe's decision model / evaluator | Not a platform we sign into. "Jev-shaped" here means the typed output contract: `p.drift`, `p.worst_domain`, `next`, probabilities. We build that model ourselves and train it on Veri. |

No real patient data goes into either service. Everything is synthetic.

**Cost and time:** Tiger is a 30-day, $1,000 trial with no card. Veri is prepaid GPU time;
the whole run below is roughly **$3 to $6** and about **1.5 hours of wall clock**, most of it
waiting for a job.

---

## 0. Before you start

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

On Windows, use `.venv/Scripts/python.exe` wherever this guide says `.venv/bin/python`.

You need:

- A Tiger Cloud account: <https://console.cloud.tigerdata.com/signup>
- A Veri account and an API key: <https://www.veri.studio/settings/api-keys>
- A Hugging Face account and a write token, because the merged weights are served from HF
- The local decision data: `python scripts/gen_decision_data.py --patients 200`

Confirm the data exists before spending anything:

```sh
ls data/decision/
# train.jsonl  val.jsonl  test.jsonl  train_grpo.jsonl  val_grpo.jsonl  test_grpo.jsonl
```

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
AUTH_ENABLED=1 OFFLINE=1 .venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Sign in as the seeded admin:

```
POST /api/auth/login
{"email": "reyes@synapshot.health", "password": "synapshot-demo"}
```

The cookie is HttpOnly, so use a cookie jar:

```sh
curl -s -c /tmp/syn.cookies -X POST localhost:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"reyes@synapshot.health","password":"synapshot-demo"}'

curl -s -b /tmp/syn.cookies 'localhost:8000/api/pulse?minutes=60'
curl -s -b /tmp/syn.cookies 'localhost:8000/api/pulse?bench=1'
```

`/api/pulse` returns `source: "continuous aggregate"` when it answered from `metrics_1m`,
or `source: "raw"` with a reason while the aggregate is empty or unavailable. `bench=1` is
admin-only and reports the measured raw-versus-aggregate timings.

For a call token and a model decision:

```sh
# list a patient's call link, then create/read a call through the existing routes
curl -s -b /tmp/syn.cookies localhost:8000/api/patients | head
curl -s -b /tmp/syn.cookies -X POST localhost:8000/api/call/<token>/next-block \
  -H 'content-type: application/json' -d '{"done":["symptoms"]}'
```

The response names its source. With no Veri key it says `heuristic`. After section 2 it
should say `veri`.

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

## 2. Veri

### 2.1 Install and sign in

```sh
uv tool install 'veri-sdk[mcp]'      # or: pipx install --force 'veri-sdk[mcp]'
veri version                          # need 0.2.44 or newer
veri login --token vk_...             # or `veri login` for the browser flow
veri whoami
veri billing balance
```

`VERI_API_KEY` in the environment overrides the config file, which is what the scripts use.
The CLI stores credentials in `~/.config/veri/config.toml` (Linux) or
`~/Library/Application Support/veri/config.toml` (macOS). On Windows, use `veri whoami` to
see the active path.

The L4-24GB shape is about **$1.05 per GPU-hour**. A 0.5B LoRA SFT run is typically 20 to 40
minutes; GRPO is another 20 to 40. Add credit before submitting.

### 2.2 Connect Hugging Face once

The LoRA adapter cannot be deployed directly. Veri merges it into the base model and pushes
standalone weights, and the serving box has no HF token, so the repo **must be public**.

```sh
veri hf set        # paste a HF token with write access when prompted
```

If you skip this, a job with `hf_push` fails at submit with a 400. That is a fail-fast, not
a retry situation.

### 2.3 Validate and upload the datasets

The CLI auto-detects the chat format. Do this for both files:

```sh
veri datasets check data/decision/train.jsonl
veri datasets upload data/decision/train.jsonl --name synapshot-sft
# prints the dataset id; copy it

veri datasets check data/decision/train_grpo.jsonl
veri datasets upload data/decision/train_grpo.jsonl --name synapshot-grpo
# copy this id too
```

What is in them:

- `train.jsonl`: `messages` rows, system + state + the typed JSON answer. This teaches the
  output contract.
- `train_grpo.jsonl`: `prompt` (the state as a JSON string) and `answer` (the oracle labels,
  including the heuristic gain and minutes per block). The reward reads `answer`; the
  training config's `system_prompt` turns each string prompt into system + user.
- `test.jsonl` and `test_grpo.jsonl` stay local. They are the held-out set for `veri_eval.py`.

Uploading byte-identical content twice returns the same dataset id, so a re-upload is not a
duplicate. Dataset ids are bare strings; use exactly what the CLI prints.

### 2.4 SFT: teach the JSON contract

Dry run first. This prints the exact request body and spends nothing:

```sh
.venv/bin/python scripts/veri_train.py --method sft \
  --dataset-id <sft_dataset_id> \
  --hf-repo <your-hf-user>/synapshot-adaptive-sft
```

Check the printed body:

- `method` is `sft_text`
- `gpu` is `{"gpu_type": "L4-24GB", "gpu_count": 1}` (an object, not top-level fields)
- `hyperparameters` has `num_epochs`, `lora_rank: 16`, `learning_rate: 2e-5`
- `hf_push` has `artifact: "merged"` and `private: false`

Submit:

```sh
VERI_API_KEY=vk_... .venv/bin/python scripts/veri_train.py --method sft \
  --dataset-id <sft_dataset_id> \
  --hf-repo <your-hf-user>/synapshot-adaptive-sft --submit

veri jobs get <job_id>
veri jobs logs <job_id> -f
```

The job goes `queued -> provisioning -> configuring -> running -> completed`, typically
about 20 to 40 minutes. When it completes, `veri jobs get <job_id> --format json` has
`hf_repo_url`; that repo is the merged SFT model and the base for GRPO.

### 2.5 GRPO: reinforce the choice

The crucial detail: `--base-model` is the **merged SFT repo**, not the original Qwen. GRPO
starts from a policy that can already emit the schema, and the reward improves which block
it picks. Starting from base Qwen gives every rollout zero reward because the output is
not valid JSON.

```sh
.venv/bin/python scripts/veri_train.py --method grpo \
  --base-model <your-hf-user>/synapshot-adaptive-sft \
  --dataset-id <grpo_dataset_id> \
  --steps 300 \
  --hf-repo <your-hf-user>/synapshot-adaptive-qwen-0.5b
```

Submit with `--submit`, then open the job's dashboard (`dashboard_url` in
`veri jobs get <id> --format json`) and watch:

| Metric | Healthy | If not |
| --- | --- | --- |
| `reward` | Climbs, then plateaus | Flat at 0: the model is not producing valid JSON, or the reward cannot parse it. Check the SFT base and the reward source. |
| `reward_std` | Stays above 0 | Collapses near 0: all rollouts are identical. Lower the learning rate or add diversity via the reward. |
| `completions/mean_length` | Stable or slightly up | Grows toward 128 without reward: length exploitation. Add a length penalty or lower `max_response_length`. |
| `loss` | Noisy | It is RL loss; do not expect it to decrease monotonically. |

300 steps at 8 rollouts on a 0.5B model on one L4 is roughly $1 to $2. If reward is still
flat after 50 steps, cancel and fix the data/reward; do not buy more steps.

### 2.6 Deploy the merged weights

Use the deployment CLI, not a training job id: a LoRA job cannot be served directly
(Veri issue VS-559), and `hf_push` already produced a merged repo.

```sh
veri deployments create --from-hf <your-hf-user>/synapshot-adaptive-qwen-0.5b \
  --name synapshot-adaptive \
  --gpu-type L4-24GB \
  --min-replicas 0 --max-replicas 1

veri deployments get <deployment_id> --format json
```

`--min-replicas 0` means scale-to-zero: it does not bill while idle, and the first request
returns 503 `deployment_waking` with `Retry-After`. Our backend times out at 3 seconds and
falls back to the heuristic, so **warm it before the demo**:

```sh
veri deployments wake <deployment_id>
```

Or send one chat request and retry until it answers. Confirm the endpoint directly:

```sh
curl -s https://api.veri.studio/v1/deployments/<deployment_id>/chat/completions \
  -H "Authorization: Bearer $VERI_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"synapshot-adaptive","messages":[
       {"role":"system","content":"Answer with JSON only."},
       {"role":"user","content":"{\"done\":[\"symptoms\"],\"remaining\":[\"memory\",\"ocular\",\"speech\"]}"}
     ],"temperature":0,"max_tokens":128}'
```

Then wire the app:

```sh
# .env
VERI_API_KEY=vk_...
VERI_DEPLOYMENT_ID=<deployment_id>
VERI_MODEL=synapshot-adaptive
VERI_API_URL=https://api.veri.studio
ADAPTIVE_MODE=veri
```

Restart the server. `POST /api/call/{token}/next-block` must now return `source: "veri"`. If
it says `heuristic`, the request timed out or the response failed schema validation; check
`ms`, the deployment state, and the raw response.

### 2.7 Score the model against the local policies

`veri_predict.py` asks the deployment for one answer per held-out state. It writes `next`
and `p` per line, which is what the evaluation reads:

```sh
.venv/bin/python scripts/veri_predict.py --limit 200
.venv/bin/python scripts/veri_eval.py --predictions data/decision/model_predictions.jsonl
```

The first command prints the schema-valid rate. Failures are written with an empty `next`
and the raw reply, so the evaluation counts them as schema failures instead of dropping
them. If the rate is below about 95%, go back to SFT with more examples or more epochs
before trusting the policy numbers.

The evaluation compares four policies on the same held-out points:

- `full`: run all four blocks
- `short-rule`: drop ocular when the camera quality is bad
- `heuristic`: the deterministic information-per-minute controller
- `model`: the deployed model

It reports minutes spent, information per minute, missed abnormal domains, and posterior
standard deviation. The generator's oracle labels are the truth here, so these numbers
measure the pipeline and the policy, not clinical benefit. Say that out loud in the demo.

### 2.8 Optional: close the trace loop

This is the strongest thing to show a judge after the model is live. It is also the easiest
place to accidentally capture PHI, so keep it synthetic.

1. Recreate the deployment with request/response body tracing enabled (`--trace-bodies` on
   `veri deployments create`).
2. Run 20 to 30 synthetic calls through `/api/call/{token}/next-block`.
3. Import that window into the GRPO dataset:

```sh
curl -X POST https://api.veri.studio/v1/datasets/<dataset_id>/import-traces \
  -H "Authorization: Bearer $VERI_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"deployment":"<deployment_id>","from":"<ISO-8601>","to":"<ISO-8601>"}'
```

4. Snapshot the dataset, submit a second GRPO run, and compare the eval table before and
   after. The story is: deployed model, real interactions, those become training rows, the
   next model is better.

### 2.9 Stop billing

A deployment with `min_replicas >= 1` bills per minute until you stop it. Scale-to-zero
parks it for free but wakes on the first request.

```sh
veri deployments stop <deployment_id>    # immediate and permanent for that deployment
veri jobs list                           # make sure nothing is still running
veri billing balance
```

`stop` is not a pause; to serve again, create a new deployment from the same HF repo.

### Veri pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401` / `invalid_or_expired_token` | Key wrong, or `VERI_API_KEY` from another workspace | `veri whoami`, mint a fresh key, check the workspace |
| Submit `400` on `hf_push` | HF integration not connected, or `artifact: "adapter"` without `lora_rank` | `veri hf set`; keep `artifact: "merged"` |
| `CAPACITY_UNAVAILABLE` | No L4 free right now | Retry a few times, or use the `Alternatives:` shapes in the error; nothing was billed |
| `CONCURRENT_JOB_LIMIT` | Four in-flight jobs in the workspace | Wait for one to finish or cancel it; retrying will not help |
| `deployment_waking` 503 | Scale-to-zero deployment is cold | Wait `Retry-After`, wake it before the demo |
| `source: "heuristic"` with a live key | 3-second timeout, schema-invalid reply, or deployment stopped | Check `veri deployments get`, warm it, inspect the raw completion |
| Reward flat at 0 | GRPO base cannot emit JSON, or the reward never parses a completion | Use the merged SFT repo as `base_model`; inspect a raw completion |
| Merged repo private | Serving boxes have no HF token | Re-push with `private: false` |
| Surprise bill | A deployment is still serving | `veri deployments list`, stop strays |

---

## 3. Demo-day order

| Time | Action | Proof to keep |
| --- | --- | --- |
| 0:00 | Tiger service, `.env`, install driver | `psycopg` connection prints |
| 0:10 | `tiger.bootstrap()`, `tiger_check.py` | extension, hypertable, 2 CAGGs |
| 0:20 | seed + `tiger_load.py --rows 300000 --compress` | rows/s and compression ratio |
| 0:30 | Veri login, HF connect, upload both datasets | two dataset ids |
| 0:40 | Submit SFT; while it runs, rehearse the Tiger demo | job id, `hf_repo_url` when done |
| 1:15 | Submit GRPO on the merged SFT repo | reward curve screenshot |
| 1:45 | Deploy merged weights, warm, set `ADAPTIVE_MODE=veri` | next-block `source: "veri"` |
| 1:55 | `veri_predict.py` + `veri_eval.py` | four-policy table |
| 2:05 | Freeze: screenshots, model card, cost, `veri deployments stop` | final numbers |

If a job is slow, do not block the demo on it. The heuristic path is the designed fallback
and the response names it honestly. Show the trained row if it is ready; if it is not, show
the eval with the model row empty and say so. That is stronger than a fake number.

## 4. What to show in three minutes

1. **The call**: a live check-in returns the next block with `source: "veri"`, probabilities,
   and minutes saved. Then stop the deployment, call again, and show `source: "heuristic"`
   with the same contract. The fallback is a feature.
2. **Tiger**: `tiger_check.py` on screen; hypertable, two aggregates, compression ratio, and
   the raw-versus-aggregate timing from `?bench=1`.
3. **The model**: HF repo with merged weights, the SFT/GRPO config, the reward file, and the
   four-policy table. Say the labels are synthetic and this is not a medical device.
4. **The loop**: traces imported as dataset rows, then the next model. That is the part that
   makes it a system rather than a one-off fine-tune.
