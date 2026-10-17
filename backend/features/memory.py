"""Fifteen word list learning, immediate and delayed recall with fuzzy matching.

The word list is our own. A licensed test list (RAVLT and friends) must not be used in a
demo, and keeping our own list also means it can be rotated per patient later.
"""

from ..config import cfg

WORDS = [
    "anchor", "candle", "river", "pepper", "saddle", "marble", "forest", "button",
    "kettle", "piano", "basket", "tunnel", "feather", "meadow", "rocket",
]
CUT = 82   # fuzzy match score needed to count a word, 0 to 100


def ratio(a: str, b: str) -> float:
    """Similarity of two words, 0 to 100, using rapidfuzz when it is installed."""
    try:
        from rapidfuzz import fuzz

        return float(fuzz.ratio(a.lower(), b.lower()))
    except Exception:
        import difflib

        return 100.0 * difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def score(said: list[str], target: list[str] | None = None, cut: float = CUT) -> dict:
    """Count how many list words were recalled, with fuzzy matching and no double counts.

    A said word counts for the best matching unused target word above the cut.
    """
    target = list(target or WORDS)
    left = list(target)
    hits, extra = [], []
    for raw in said:
        word = str(raw).strip()
        if not word:
            continue
        best, bestj = 0.0, -1
        for j, tgt in enumerate(left):
            got = ratio(word, tgt)
            if got > best:
                best, bestj = got, j
        if bestj >= 0 and best >= cut:
            hits.append(left.pop(bestj))
        else:
            extra.append(word)
    return {
        "correct": len(hits),
        "of": len(target),
        "words": hits,
        "intrusions": len(extra),
        "intrusion_words": extra,
    }


def immediate(said: list[str]) -> float:
    """Immediate recall count."""
    return float(score(said)["correct"])


def delayed(said: list[str]) -> float:
    """Delayed recall count."""
    return float(score(said)["correct"])


def encode_line() -> str:
    """The line the agent reads to present the list."""
    return ("I am going to read fifteen words. Listen, and when I stop, say back as many as "
            "you can remember in any order. " + ", ".join(WORDS) + ".")


def words_for(pid: str = "") -> list[str]:
    """The list for one patient. One list for now, per patient rotation is a later change."""
    del pid, cfg
    return list(WORDS)
