# Veri setup

The application stores its records locally in SQLite. Veri remains optional.

## Veri

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
