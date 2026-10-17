"""Animal naming in 60 seconds. Counts valid unique animals with fuzzy matching."""

from . import memory

SECONDS = 60.0
# 80, not 86. Speech recognition spells spoken animal names wrong ("elefant"), and a
# stricter cut throws away answers the patient actually gave. Checked against the whole
# list: no non-animal in testing matched any entry at 80.
CUT = 80
ANIMALS = [
    "dog", "cat", "horse", "cow", "pig", "sheep", "goat", "chicken", "duck", "goose",
    "lion", "tiger", "leopard", "cheetah", "bear", "wolf", "fox", "deer", "moose", "elk",
    "rabbit", "hare", "mouse", "rat", "squirrel", "beaver", "otter", "badger", "skunk",
    "raccoon", "monkey", "ape", "gorilla", "chimpanzee", "orangutan", "elephant", "rhino",
    "hippo", "giraffe", "zebra", "camel", "llama", "alpaca", "donkey", "mule", "bison",
    "buffalo", "antelope", "gazelle", "kangaroo", "koala", "wombat", "possum", "platypus",
    "whale", "dolphin", "porpoise", "seal", "walrus", "shark", "ray", "tuna", "salmon",
    "trout", "cod", "herring", "eel", "octopus", "squid", "crab", "lobster", "shrimp",
    "snail", "slug", "worm", "spider", "scorpion", "ant", "bee", "wasp", "beetle",
    "butterfly", "moth", "dragonfly", "grasshopper", "cricket", "fly", "mosquito",
    "snake", "lizard", "gecko", "iguana", "crocodile", "alligator", "turtle", "tortoise",
    "frog", "toad", "salamander", "newt", "eagle", "hawk", "falcon", "owl", "crow",
    "raven", "sparrow", "robin", "finch", "pigeon", "dove", "swan", "heron", "stork",
    "flamingo", "pelican", "penguin", "ostrich", "emu", "peacock", "parrot", "hummingbird",
    "bat", "hedgehog", "mole", "ferret", "weasel", "mink", "panda", "sloth", "armadillo",
    "anteater", "meerkat", "hyena", "jackal", "coyote", "lynx", "bobcat", "cougar",
    "jaguar", "panther", "yak", "ox", "boar", "reindeer", "caribou", "ibex", "chamois",
]


def valid(word: str, cut: float = CUT) -> str | None:
    """The canonical animal name a said word matches, or None."""
    word = str(word).strip().lower()
    if not word:
        return None
    best, name = 0.0, None
    for animal in ANIMALS:
        got = memory.ratio(word, animal)
        if got > best:
            best, name = got, animal
    return name if best >= cut else None


def score(said: list[str], seconds: float = SECONDS) -> dict:
    """Unique valid animals named, plus repeats and misses.

    rate = unique valid animals per minute
    """
    seen, reps, bad = [], 0, []
    for raw in said:
        name = valid(raw)
        if name is None:
            bad.append(str(raw))
        elif name in seen:
            reps += 1
        else:
            seen.append(name)
    return {
        "fluency_animals": float(len(seen)),
        "rate_per_min": float(60.0 * len(seen) / max(seconds, 1e-6)),
        "repeats": reps,
        "rejected": bad,
        "animals": seen,
    }
