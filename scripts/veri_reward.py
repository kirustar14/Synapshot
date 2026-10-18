"""GRPO reward for the adaptive decision policy.

Veri calls `reward(completions, answer, **kwargs)` once per group of rollouts. `answer` is
the oracle label JSON from `gen_decision_data.py`: the drift class, the worst domain, the
heuristic's best block, and its information per minute for every remaining block.

Scoring, bounded at 1.0:

    +0.15  the completion is the exact JSON contract
    +0.20  drift argmax matches the oracle
    +0.20  worst domain argmax matches the oracle
    +0.25  the chosen block's information per minute, relative to the best available
    +0.20  the chosen block's cost is proportionate (a cheap block is not penalised)
    -1.00  a banned phrase, or a safety block chosen instead of a measurement block

A safety block can never be a legal `next` value, so choosing one is a format failure and
a zero, not a small penalty.
"""

import json
import re

BANNED = ("diagnos", "cleared to", "return to play", "medication dose")
BLOCKS = ("ocular", "speech", "memory", "symptoms", "stop")


def _text(completion) -> str:
    if isinstance(completion, list):
        return str(completion[-1].get("content", "")) if completion else ""
    return str(completion)


def _parse(raw: str):
    """Accept a JSON object, optionally wrapped in a fenced block."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _valid(got) -> bool:
    if not isinstance(got, dict):
        return False
    if str(got.get("next")) not in BLOCKS:
        return False
    probs = got.get("p")
    if not isinstance(probs, dict):
        return False
    for name, want in (("drift", 3), ("worst_domain", 5)):
        vec = probs.get(name)
        if not isinstance(vec, list) or len(vec) != want:
            return False
        try:
            vals = [float(v) for v in vec]
        except (TypeError, ValueError):
            return False
        if any(v < 0 for v in vals) or abs(sum(vals) - 1.0) > 0.02:
            return False
    return True


def reward(completions, answer, **kwargs):
    """One score per completion. Pure, no imports from the app, no I/O."""
    del kwargs
    scores = []
    for completion, expected in zip(completions, answer):
        text = _text(completion)
        lowered = text.lower()
        if any(word in lowered for word in BANNED):
            scores.append(0.0)
            continue

        got = _parse(text)
        if not _valid(got):
            scores.append(0.0)
            continue

        try:
            want = json.loads(expected) if isinstance(expected, str) else expected
        except (TypeError, ValueError):
            scores.append(0.0)
            continue

        score = 0.15
        probs = got["p"]
        drift_pred = max(range(3), key=lambda i: float(probs["drift"][i]))
        domain_pred = max(range(5), key=lambda i: float(probs["worst_domain"][i]))
        drift_want = {"worse": 0, "stable": 1, "better": 2}.get(str(want.get("drift")), 1)
        domains = ["ocular", "speech", "memory", "symptom", "none"]
        domain_want = domains.index(str(want.get("worst_domain"))) if str(want.get("worst_domain")) in domains else 4
        score += 0.20 if drift_pred == drift_want else 0.0
        score += 0.20 if domain_pred == domain_want else 0.0

        gain = {k: float(v) for k, v in (want.get("gain") or {}).items()}
        minutes = {k: float(v) for k, v in (want.get("minutes") or {}).items()}
        nxt = str(got.get("next"))
        if nxt == "stop":
            # Stopping is only right when the oracle also stopped. Otherwise it forgoes
            # information and earns nothing beyond the schema credit.
            score += 0.05 if str(want.get("next_oracle")) == "stop" else 0.0
        else:
            best = max(gain.values()) if gain else 1.0
            best = best if best > 0 else 1.0
            score += 0.25 * max(0.0, gain.get(nxt, 0.0)) / best
            cost = minutes.get(nxt, 1.0)
            cheapest = min(minutes.values()) if minutes else 1.0
            # Longer blocks are acceptable when they buy the information, but not free.
            score += 0.20 * max(0.0, 1.0 - max(0.0, cost - cheapest) / 6.0)
            if str(want.get("next_oracle")) == nxt:
                score += 0.05

        scores.append(round(max(0.0, min(1.0, score)), 4))
    return scores


def _self_test() -> None:
    """No pytest dependency: Veri imports this file on its own."""
    good = json.dumps({"p": {"drift": [0.7, 0.2, 0.1],
                             "worst_domain": [0.1, 0.7, 0.1, 0.05, 0.05]},
                       "next": "speech"})
    answer = json.dumps({"drift": "worse", "worst_domain": "speech", "next_oracle": "speech",
                         "gain": {"speech": 3.0, "ocular": 1.0, "memory": 0.4, "symptoms": 0.2},
                         "minutes": {"speech": 2.4, "ocular": 2.8, "memory": 2.75, "symptoms": 1.4}})
    bad = "I think this patient is worsening. They should be cleared to play."
    got = reward([good, bad, "{}"], [answer, answer, answer])
    assert got[0] > 0.8, got
    assert got[1] == 0.0, got
    assert got[2] == 0.0, got
    print(f"  reward self test: {got}")


if __name__ == "__main__":
    _self_test()
