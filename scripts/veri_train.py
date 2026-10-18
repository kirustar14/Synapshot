"""Submit the decision-model training job to Veri, or print exactly what would be sent.

    python scripts/gen_decision_data.py --patients 200
    veri datasets check data/decision/train.jsonl
    veri datasets upload data/decision/train.jsonl --name synapshot-sft
    python scripts/veri_train.py --method sft --dataset-id <id>          # dry run
    python scripts/veri_train.py --method sft --dataset-id <id> \\
        --hf-repo <you>/synapshot-adaptive-sft --submit
    python scripts/veri_train.py --method grpo --dataset-id <id> \\
        --base-model <you>/synapshot-adaptive-sft \\
        --hf-repo <you>/synapshot-adaptive-qwen-0.5b --submit

The dataset id is the bare id `veri datasets upload` prints. SFT runs first to teach the
JSON contract; GRPO then reinforces the choice on top of the SFT weights. `hf_push` merges
the LoRA adapter, because Veri cannot deploy a LoRA job directly.

A deployment is the step after the job finishes. See TIGER_VERI_SETUP.md for the order.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.agent import adaptive  # noqa: E402

BASE = os.environ.get("VERI_API_URL", "https://api.veri.studio").rstrip("/")


def body(args, reward: str) -> dict:
    hyper = {
        "lora_rank": 16,
        "lora_alpha": 32,
        "learning_rate": 2e-5,  # LoRA-scale; full fine-tuning would use 2e-6 to 5e-6
    }
    if args.method == "grpo":
        hyper.update({
            "max_steps": int(args.steps or 200),
            "rollouts_per_prompt": 8,
            "max_response_length": 128,
            # A string prompt becomes system + user, so the model sees the JSON contract
            # even though train_grpo.jsonl stores the state as a bare string.
            "system_prompt": adaptive.SYSTEM,
        })
    else:
        epochs = int(args.epochs) if float(args.epochs).is_integer() else float(args.epochs)
        hyper.update({"num_epochs": epochs, "max_seq_length": 2048})
        if args.steps:
            hyper["max_steps"] = int(args.steps)  # overrides num_epochs
    got = {
        "base_model": args.base_model,
        "dataset_id": args.dataset_id,
        "output_name": args.output,
        "method": "grpo" if args.method == "grpo" else "sft_text",
        "hyperparameters": hyper,
        # The API wants gpu as an object; top-level gpu_type/gpu_count are ignored or 400.
        "gpu": {"gpu_type": "L4-24GB", "gpu_count": 1},
    }
    if args.method == "grpo":
        got["reward_source"] = reward
    if args.hf_repo:
        # A LoRA adapter cannot be deployed on its own. Veri merges it into the base model
        # and pushes standalone weights, which is what the deployment downloads.
        got["hf_push"] = {"repo": args.hf_repo, "artifact": "merged", "private": False}
    return got


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--method", choices=("sft", "grpo"), default="sft")
    ap.add_argument("--base-model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--dataset-id", default="")
    ap.add_argument("--output", default="synapshot-adaptive-qwen-0.5b")
    ap.add_argument("--steps", type=int, default=0,
                    help="GRPO max_steps (default 200); for SFT it caps num_epochs")
    ap.add_argument("--epochs", type=float, default=1.0, help="SFT epochs")
    ap.add_argument("--hf-repo", default="",
                    help="push the merged weights here so a deployment can serve them"
                         " (run `veri hf set` once first)")
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--reward", default=str(ROOT / "scripts" / "veri_reward.py"))
    args = ap.parse_args()

    if not args.dataset_id:
        print("  --dataset-id is required. Upload the JSONL first:")
        print(f"  veri datasets upload {ROOT / 'data' / 'decision' / 'train.jsonl'} --name synapshot-sft")
        return 2

    reward = ""
    if args.method == "grpo":
        reward = Path(args.reward).read_text(encoding="utf-8")
        if "def reward(" not in reward:
            print(f"  {args.reward} has no reward function")
            return 2

    payload = body(args, reward)
    shown = dict(payload)
    if shown.get("reward_source"):
        shown["reward_source"] = f"<{len(reward)} chars from {Path(args.reward).name}>"
    print("")
    print(f"  POST {BASE}/v1/training_jobs")
    print(json.dumps(shown, indent=2))
    print("")
    print(f"  data: train at data/decision/train{'_grpo' if args.method == 'grpo' else ''}.jsonl")
    if args.hf_repo:
        print(f"  merged weights: https://huggingface.co/{args.hf_repo}")
    else:
        print("  no --hf-repo: the job keeps an adapter, which cannot be deployed on its own")
    print("  cost guide: about $1.05 per L4 GPU-hour, roughly 20 to 70 minutes for this size")
    print("  GPU time is prepaid; check the balance with `veri billing balance`")

    if not args.submit:
        print("")
        print("  dry run. Add --submit with VERI_API_KEY set to send it.")
        return 0

    key = os.environ.get("VERI_API_KEY", "")
    if not key:
        print("  VERI_API_KEY is not set")
        return 2
    try:
        with httpx.Client(timeout=60) as client:
            res = client.post(f"{BASE}/v1/training_jobs", json=payload,
                              headers={"Authorization": f"Bearer {key}"})
            res.raise_for_status()
            got = res.json()
    except Exception as exc:  # noqa: BLE001
        print(f"  submit failed: {exc}")
        return 1
    print("")
    print(f"  job {got.get('id')}  status {got.get('status')}")
    print(f"  poll: veri jobs get {got.get('id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
