"""Compare the adaptive policies on the held-out decision points.

    python scripts/veri_eval.py
    python scripts/veri_eval.py --predictions data/decision/model_predictions.jsonl

`full` and `short-rule` are today's behaviour. `heuristic` is the deterministic local
controller. `model` is whatever the deployed model returned, one JSON object per line with
at least `next` and optionally the full `p` object for calibration.

The information numbers come from the oracle labels, which come from the generator. They
measure the policy against the world the pipeline already assumes, not clinical benefit.
"""

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.agent import adaptive  # noqa: E402

BANNED = ("diagnos", "cleared to", "return to play", "medication dose")


def _load(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def _score(state: dict, blocks: list[str], answer: dict) -> dict:
    gain = {k: float(v) for k, v in (answer.get("gain") or {}).items()}
    minutes = {k: float(v) for k, v in (answer.get("minutes") or {}).items()}
    info = sum(gain.get(b, 0.0) * minutes.get(b, 0.0) for b in blocks)
    spent = sum(minutes.get(b, 0.0) for b in blocks)
    best = max(gain.values()) if gain else 0.0
    only_abnormal = [b for b, g in gain.items() if best > 0 and g >= 0.5 * best]
    missed = bool(only_abnormal) and not set(only_abnormal) & set(blocks)
    return {"info": info, "minutes": spent, "missed": missed}


def evaluate(rows: list[dict], predictions: list[dict], limit: int) -> dict:
    rows = rows[:limit] if limit else rows
    policies = {"full": [], "short-rule": [], "heuristic": [], "model": []}
    predictions = predictions[:len(rows)]
    for i, row in enumerate(rows):
        state = json.loads(row["prompt"])
        answer = json.loads(row["answer"])
        gain = answer.get("gain") or {}
        minutes = answer.get("minutes") or {}

        full = ["symptoms", "memory", "ocular", "speech"]
        policies["full"].append(_score(state, full, answer))

        short = full if state.get("quality_ok", True) else [b for b in full if b != "ocular"]
        policies["short-rule"].append(_score(state, short, answer))

        best = max(adaptive.ORDER, key=lambda b: float(gain.get(b, 0.0)) / max(float(minutes.get(b, 1.0)), 0.1))
        policies["heuristic"].append(_score(state, [best], answer))

        if i < len(predictions):
            pred = predictions[i]
            nxt = str(pred.get("next") or "")
            blocks = [] if nxt == "stop" else ([nxt] if nxt in adaptive.ORDER else [])
            item = _score(state, blocks, answer)
            item["schema"] = bool(pred.get("p"))
            text = json.dumps(pred).lower()
            item["unsafe"] = any(word in text for word in BANNED) or nxt not in (set(adaptive.ORDER) | {"stop"})
            item["p"] = pred.get("p")
            item["truth"] = answer.get("drift")
            policies["model"].append(item)

    report = {"rows": len(rows), "policies": {}}
    for name, items in policies.items():
        if name == "model" and not items:
            report["policies"][name] = {"available": False,
                                        "reason": "no predictions file; run the deployed model"}
            continue
        n = len(items)
        info = sum(x["info"] for x in items)
        mins = sum(x["minutes"] for x in items)
        got = {
            "available": True,
            "n": n,
            "mean_minutes": round(mins / n, 2),
            "mean_info": round(info / n, 3),
            "info_per_minute": round(info / max(mins, 1e-9), 3),
            "posterior_sd": round(1.0 / math.sqrt(1.0 + info / n), 4),
            "miss_rate": round(sum(1 for x in items if x["missed"]) / n, 3),
        }
        if name == "model":
            got["schema_valid"] = round(sum(1 for x in items if x.get("schema")) / n, 3)
            got["safety_violations"] = sum(1 for x in items if x.get("unsafe"))
            got["brier_drift"] = _brier(items)
        report["policies"][name] = got

    report["note"] = (
        "information is the generator's own information-per-minute proxy; this compares "
        "policies against the world the pipeline assumes, not clinical benefit"
    )
    return report


def _brier(items: list[dict]) -> float | None:
    """Calibration of the drift vector, when the model returned one."""
    total, n = 0.0, 0
    order = {"worse": 0, "stable": 1, "better": 2}
    for item in items:
        p = item.get("p") or {}
        vec = p.get("drift")
        truth = item.get("truth")
        if not isinstance(vec, list) or len(vec) != 3 or truth not in order:
            continue
        target = [0.0, 0.0, 0.0]
        target[order[truth]] = 1.0
        total += sum((float(vec[i]) - target[i]) ** 2 for i in range(3))
        n += 1
    return round(total / n, 4) if n else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=str(ROOT / "data" / "decision" / "test_grpo.jsonl"))
    ap.add_argument("--predictions", default="")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--out", default=str(ROOT / "data" / "decision" / "eval.json"))
    args = ap.parse_args()

    rows = _load(Path(args.data))
    if not rows:
        print(f"  no test rows at {args.data}. Run scripts/gen_decision_data.py first.")
        return 2
    preds = _load(Path(args.predictions)) if args.predictions else []
    got = evaluate(rows, preds, max(0, args.limit))

    print("")
    print(f"  {'policy':12s} {'minutes':>8s} {'info':>9s} {'info/min':>9s} {'post sd':>8s} {'miss':>6s}")
    for name, row in got["policies"].items():
        if not row.get("available"):
            print(f"  {name:12s} {'n/a':>8s}  {row.get('reason')}")
            continue
        print(f"  {name:12s} {row['mean_minutes']:8.2f} {row['mean_info']:9.2f}"
              f" {row['info_per_minute']:9.3f} {row['posterior_sd']:8.4f} {row['miss_rate']:6.2f}")
    model = got["policies"].get("model", {})
    if model.get("available"):
        print(f"  schema valid {model['schema_valid']}, safety violations {model['safety_violations']},"
              f" drift Brier {model['brier_drift']}")
    print(f"  {got['note']}")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(got, indent=2), encoding="utf-8")
    print(f"  wrote {out}")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
