"""Ask the deployed Veri model for one answer per held-out decision point.

    python scripts/veri_predict.py --limit 200
    python scripts/veri_eval.py --predictions data/decision/model_predictions.jsonl

The output is one JSON object per line with `next` and the normalized `p` object, which is
exactly what `veri_eval.py` reads. A prompt the deployment could not answer is written with
an empty `next` and the raw reply, so the evaluation counts it as a schema failure instead
of quietly dropping it.

Reads VERI_API_KEY, VERI_DEPLOYMENT_ID and VERI_MODEL from the environment, the same three
values the backend uses. `--dry-run` only checks the dataset and prints what would be sent.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.agent import adaptive  # noqa: E402


def _load(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def _content(raw: str) -> dict | None:
    """Strip a code fence if the model added one, then parse."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
    try:
        return adaptive._valid(json.loads(text))
    except (TypeError, ValueError):
        return None


def ask(url: str, key: str, model: str, prompt) -> tuple[dict | None, str]:
    """One chat completion, one retry on a transport or 5xx error."""
    messages = prompt if isinstance(prompt, list) else [
        {"role": "system", "content": adaptive.SYSTEM},
        {"role": "user", "content": prompt},
    ]
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.0,
        "max_tokens": 128,
        "response_format": {"type": "json_object"},
    }
    last = ""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=20.0) as client:
                res = client.post(url, json=body,
                                  headers={"Authorization": f"Bearer {key}"})
                if res.status_code >= 500 and attempt == 0:
                    last = f"HTTP {res.status_code}"
                    time.sleep(0.5)
                    continue
                res.raise_for_status()
                return _content(res.json()["choices"][0]["message"]["content"]), ""
        except Exception as exc:  # noqa: BLE001 - report the miss, keep going
            last = f"{type(exc).__name__}: {exc}"
            if attempt == 0:
                time.sleep(0.5)
    return None, last


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/decision/test_grpo.jsonl")
    ap.add_argument("--out", default="data/decision/model_predictions.jsonl")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--api-url", default=os.environ.get("VERI_API_URL", "https://api.veri.studio"))
    ap.add_argument("--deployment", default=os.environ.get("VERI_DEPLOYMENT_ID", ""))
    ap.add_argument("--model", default=os.environ.get("VERI_MODEL", "synapshot-adaptive"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    path = ROOT / args.data
    if not path.exists():
        print(f"no dataset at {path}. Run scripts/gen_decision_data.py first.")
        return 1
    rows = _load(path)
    rows = rows[:args.limit] if args.limit else rows
    if not rows:
        print(f"{path} is empty")
        return 1
    print(f"{len(rows)} held-out decision points from {path}")

    if args.dry_run:
        first = rows[0]["prompt"]
        if not isinstance(first, str):
            first = json.dumps(first, sort_keys=True)
        print(f"would POST to {args.api_url}/v1/deployments/<id>/chat/completions")
        print(f"model: {args.model}")
        print(f"system prompt: {adaptive.SYSTEM[:90]}...")
        print(f"first state: {first[:300]}")
        print("dry run: nothing written")
        return 0

    key = os.environ.get("VERI_API_KEY", "")
    if not key or not args.deployment:
        print("set VERI_API_KEY and VERI_DEPLOYMENT_ID, or run with --dry-run")
        return 2

    url = f"{args.api_url}/v1/deployments/{args.deployment}/chat/completions"
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    good = 0
    failures = []
    with out_path.open("w", encoding="utf-8") as fh:
        for i, row in enumerate(rows):
            got, error = ask(url, key, args.model, row["prompt"])
            if got is None:
                rec = {"next": "", "error": error or "invalid contract"}
                failures.append((i, rec["error"]))
            else:
                rec = {"next": got["next"], "p": got["p"]}
                good += 1
            fh.write(json.dumps(rec) + "\n")
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(rows)}  schema-valid {good}")

    print(f"wrote {len(rows)} predictions to {out_path}")
    print(f"schema-valid {good}/{len(rows)} ({100.0 * good / max(len(rows), 1):.1f}%)")
    for i, error in failures[:5]:
        print(f"  row {i}: {error}")
    print("next: python scripts/veri_eval.py --predictions " + args.out)
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
