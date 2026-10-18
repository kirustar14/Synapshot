"""The drug impact viewer: a receptor-weighted gain perturbation, with its interval.

What this is: for each drug, its targets are combined into one weight per region,

    w(region) = sum over targets of  affinity * direction * receptor_z(region)

and that weight scales each region's local recurrent gain by `1 + global_gain * w`. Both
sides are then simulated with this patient's own connectivity and current damage, and the
difference is what the map shows. That is the Luppi-style regional gain perturbation the
single-receptor slider already used, with a drug's target profile in place of one map.

What this is not: a dose-response model, a pharmacokinetic model, or a prediction about a
person. There is no time in it, so nothing here says when an effect would appear. Dose is
carried for recognition and never reaches a number. The whole thing is a picture of where
in the brain a drug's receptor profile would bite hardest, run through a network model.

The interval is the honest part, and getting it from the right place took two goes. The
first version ran each side several times with different noise seeds and paired them. That
produced an interval that excluded zero in all 100 regions, which is not a finding: with
the same noise on both sides the difference is nearly deterministic, so it was measuring
how reproducible the simulator is, not how sure anyone is about the effect.

What it measures now is the uncertainty that actually exists, from the two places it is
largest:

- The patient's state. The filter keeps a 200 member posterior over their recovery rate
  and floor, which is where uncertainty about their current damage lives. Members are
  drawn from it and each gives a different damaged network.
- The affinities. The numbers in formulary.json are judgement calls about how strongly a
  drug acts at each of its targets relative to its own main action. They are not measured
  constants, so each member perturbs them, and a result that only holds for one particular
  reading of the pharmacology shows up as unclear rather than as a finding.

A region whose 80% interval crosses zero is reported as unclear: across the range of
states this patient plausibly has and the range of affinities these drugs plausibly have,
the model does not agree on the sign.

What the interval still does not cover, and the Evidence drawer says so: the receptor maps
are group averages from tens of healthy volunteers, the gain perturbation is one way of
representing a drug among several, and the model itself may simply be wrong.
"""

import hashlib
import json

import numpy as np

from .. import db
from ..config import ROOT, cfg
from ..data.templates import ei_map
from . import dmf, intervention, priors, strain

NOTE = ("Hypothetical what-if, not a treatment recommendation. No dose is modelled and "
        "no timing is modelled.")

FORMULARY = ROOT / "backend" / "data" / "formulary.json"

# Posterior members drawn per run. Each one costs two feedback inhibition solves and two
# 20 second DMF simulations over 100 regions, and this runs while somebody waits. Eight
# gives an 80% interval whose ends are the 2nd and 7th order statistics, which is coarse,
# and is why a crossing interval is called unclear rather than given a number.
MEMBERS = 8
LO_Q, HI_Q = 10.0, 90.0

GAIN_LO, GAIN_HI = -0.5, 0.5
DEFAULT_GAIN = 0.2
TOP_CHANGED = 8

# Spread on the affinities, in log space. 0.35 means a member's affinity is typically
# within about 40% of the written one. The written values are a reading of each drug's
# pharmacology, not measured constants, and this is the size of disagreement that reading
# could reasonably carry.
AFFINITY_SD = 0.35

INTERVAL_COVERS = [
    "uncertainty in this patient's current damage, from the filter's own posterior",
    "uncertainty in the affinity weights, which are a judgement call about each drug's "
    "relative action at its targets",
    "simulation noise",
]
INTERVAL_MISSES = [
    "the receptor maps are group averages from tens of healthy volunteers, not this "
    "patient's receptors",
    "a regional gain perturbation is one way of representing a drug's effect among "
    "several, and the choice is not in the interval",
    "the network model itself may be wrong, which no interval computed inside it can say",
]

_BOOK: dict | None = None


def book() -> dict:
    """The formulary, loaded once."""
    global _BOOK
    if _BOOK is None:
        _BOOK = json.loads(FORMULARY.read_text())
    return _BOOK


def drugs() -> list[dict]:
    """Every drug, with whether this model can say anything about it and why not.

    A drug the model cannot represent stays in the list. Leaving it out would make the
    formulary look like a complete picture of what a patient is taking, and the most
    useful thing this screen can say about acetaminophen is that it has nothing to say.
    """
    stand_in = set(receptor_payload().get("stand_in") or [])
    out = []
    for drug in book()["drugs"]:
        targets = drug.get("targets") or []
        proxied = [t for t in targets if t.get("proxy")]
        noisy = [t for t in targets if t["receptor"] in stand_in]
        out.append({
            "name": drug["name"],
            "class": drug.get("class", ""),
            "typical_dose": drug.get("typical_dose", ""),
            "modeled": bool(drug.get("modeled")) and bool(targets),
            "targets": targets,
            "note": drug.get("note", ""),
            "why_not": drug.get("why_not", ""),
            # Said out loud on the drug's own card, not buried in a page footer.
            "proxy_targets": [t["receptor"] for t in proxied],
            "stand_in_targets": [t["receptor"] for t in noisy],
        })
    return out


def find(name: str) -> dict | None:
    """One drug by name, case-insensitively."""
    want = str(name).strip().lower()
    return next((d for d in drugs() if d["name"] == want), None)


def receptor_payload() -> dict:
    """The receptor maps, as the contract serves them."""
    return intervention.receptors()


def weights(picked: list[dict],
            jitter: np.random.Generator | None = None) -> tuple[np.ndarray, list[str], list[str]]:
    """The combined per region weight for a set of drugs, and what it rests on.

    Returns (weight, receptors used, warnings). The weight is scaled so its largest
    absolute value is 1, which makes `gain` mean the same thing whichever drug is
    selected: at gain 0.2 the most affected region's local gain moves by 20%.

    With a generator, each affinity is drawn around its written value instead of taken as
    exact. That is what puts the pharmacology's own vagueness into the interval.
    """
    maps = receptor_payload()["maps"]
    stand_in = set(receptor_payload().get("stand_in") or [])
    regions = len(next(iter(maps.values())))
    total = np.zeros(regions, dtype=float)
    used: list[str] = []
    warn: list[str] = []

    for item in picked:
        drug = find(item["name"])
        if drug is None or not drug["modeled"]:
            continue
        for target in drug["targets"]:
            name = target["receptor"]
            if name not in maps:
                warn.append(f"{drug['name']}: no map for {name}, that action is not shown")
                continue
            z = np.asarray(maps[name], dtype=float)
            affinity = float(target["affinity"])
            if jitter is not None:
                affinity *= float(np.exp(jitter.normal(0.0, AFFINITY_SD)))
            total += affinity * float(target["direction"]) * z
            if name not in used:
                used.append(name)
            if target.get("proxy"):
                warn.append(f"{drug['name']}: {name} is a proxy map, not its own target")
            if name in stand_in:
                warn.append(f"{drug['name']}: the {name} map is a stand-in, so this "
                            "effect is being simulated against smooth noise")

    peak = float(np.max(np.abs(total)))
    if peak > 1e-9:
        total = total / peak
    return total, used, sorted(set(warn))


def key(pid: str, picked: list[dict], gain: float) -> str:
    """Cache key: the patient, its week, the drugs and the gain."""
    row = db.patient(pid)
    week = int(row["week"] or 0) if row is not None else 0
    body = json.dumps({"pid": pid, "week": week, "gain": round(float(gain), 4),
                       "drugs": sorted(d["name"].lower() for d in picked)}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()[:24]


def cached(name: str) -> dict | None:
    """A stored run, or None."""
    path = cfg.cache_dir() / f"drug_{name}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def store(name: str, payload: dict) -> None:
    """Keep a run so the same selection is instant the second time."""
    try:
        (cfg.cache_dir() / f"drug_{name}.json").write_text(json.dumps(payload))
    except Exception:
        pass


def simulate(pid: str, picked: list[dict], gain: float = DEFAULT_GAIN) -> dict:
    """Run baseline and perturbed ensembles and report the difference with its interval."""
    row = db.patient(pid)
    if row is None:
        raise KeyError(f"no patient {pid}")

    gain = float(np.clip(gain, GAIN_LO, GAIN_HI))
    picked = [p for p in picked if (find(p["name"]) or {}).get("modeled")]
    name = key(pid, picked, gain)
    got = cached(name)
    if got is not None:
        return got

    weight, used, warn = weights(picked)
    if not picked or not used:
        out = {
            "ok": True, "drugs": [], "gain": gain, "modeled": False,
            "note": NOTE,
            "say": "Nothing selected that this model can represent.",
            "warnings": warn,
        }
        return out

    bio = db.dec(row["biomarkers"], {"gfap_z": 0.0, "uchl1_z": 0.0}) or {}
    zbio = float(0.5 * (float(bio.get("gfap_z", 0.0)) + float(bio.get("uchl1_z", 0.0))))
    params = db.dec(row["params"], {}) or {}
    gval = float(params.get("G") or priors.HYPER["mu_G"])

    base_ei = ei_map(zbio)

    nets = _draws(pid, MEMBERS)
    # One affinity draw per member, from a fixed seed so the same question gets the same
    # answer twice. Member i pairs one posterior state with one reading of the drug.
    rng = np.random.default_rng(abs(hash(name)) % (2 ** 31))
    perts = []
    for _ in nets:
        wm, _u, _w = weights(picked, jitter=rng)
        perts.append(base_ei * (1.0 + gain * wm))

    base = _ensemble(nets, gval, [base_ei] * len(nets))
    alt = _ensemble(nets, gval, perts)

    # Paired by member: both sides used the same network and the same noise, so the
    # difference is the drug. The spread across members is the posterior's spread, which
    # is uncertainty about this patient rather than about the simulator.
    diff = alt["rates"] - base["rates"]
    mean = diff.mean(axis=0)
    lo = np.percentile(diff, LO_Q, axis=0)
    hi = np.percentile(diff, HI_Q, axis=0)
    unclear = (lo <= 0.0) & (hi >= 0.0)

    order = np.argsort(-np.abs(np.where(unclear, 0.0, mean)))
    top = [int(i) for i in order[:TOP_CHANGED] if not bool(unclear[int(i)])]

    out = {
        "ok": True,
        "drugs": [p["name"] for p in picked],
        "gain": round(gain, 4),
        "modeled": True,
        "members": MEMBERS,
        "receptors": used,
        "weight": [round(float(v), 5) for v in weight],
        "region_effect": [round(float(v), 6) for v in mean],
        "lo": [round(float(v), 6) for v in lo],
        "hi": [round(float(v), 6) for v in hi],
        "unclear": [bool(v) for v in unclear],
        "unclear_count": int(unclear.sum()),
        "top_changed": top,
        "baseline_rate": [round(float(v), 5) for v in base["rates"].mean(axis=0)],
        "summary_delta": {
            "rate": round(float(mean.mean()), 6),
            "fc_strength": round(float(alt["fc"].mean() - base["fc"].mean()), 6),
            "metastability": round(float(alt["meta"].mean() - base["meta"].mean()), 6),
        },
        "warnings": warn,
        "interval_covers": INTERVAL_COVERS,
        "interval_misses": INTERVAL_MISSES,
        "synthetic_template": bool(receptor_payload().get("synthetic_template")),
        "note": NOTE,
        "say": _say(mean, unclear, used),
    }
    store(name, out)
    return out


def _say(mean: np.ndarray, unclear: np.ndarray, used: list[str]) -> str:
    """One sentence a clinician can read, which never says whether this is a good idea.

    Deliberately says "inside this model". For a drug with one target the affinity scale
    is absorbed into the gain, so the only spread left is the patient's own posterior, and
    the intervals come out narrow. Narrow is not the same as sure: it means the model is
    self-consistent, and the thing most likely to be wrong here is the model.
    """
    clear = int((~unclear).sum())
    maps = f"{', '.join(used)} {'map' if len(used) == 1 else 'maps'}"
    if clear == 0:
        return ("No region's effect holds its sign across this patient's posterior. The "
                f"model cannot tell, weighted by the {maps}.")
    direction = "up" if float(mean[~unclear].mean()) > 0 else "down"
    return (f"Inside this model, {clear} of {len(mean)} regions hold their sign across "
            f"this patient's posterior, mostly {direction}, weighted by the {maps}. "
            "That is self-consistency, not evidence about the drug.")


def _draws(pid: str, members: int) -> list[np.ndarray]:
    """`members` damaged networks drawn from this patient's posterior.

    The filter's ensemble is over the recovery rate k and the floor p. Each member implies
    a different amount of healing by now, so a different damage field and a different
    network. Members are taken at evenly spaced quantiles of k rather than at random, so
    the draw covers the posterior instead of clustering, and so the same patient gives the
    same answer twice.
    """
    from .attribution import damage_now
    from .shape import personal_sc
    from . import build
    from . import forecast as fcast

    row = db.patient(pid)
    week = float(row["week"] or 0)
    sc0 = personal_sc(pid)

    # damage_now already builds the week-0 field and decays it at the posterior mean. The
    # decay is the only part that varies by member, so the field is built once.
    dmg_mean, _ = damage_now(pid)
    state = build.state_of(pid)
    ens = np.asarray(state["ens"], dtype=float)
    ks = np.exp(ens[:, 0])
    ps = priors.expit(ens[:, 1])
    mean_decay = float(fcast.d_of(1.0, float(ks.mean()), float(ps.mean()),
                                  np.array([week]))[0])
    dmg0 = dmg_mean / (mean_decay if abs(mean_decay) > 1e-9 else 1.0)

    order = np.argsort(ks)
    picks = np.linspace(0, len(order) - 1, members).round().astype(int)
    out = []
    for idx in picks:
        j = int(order[int(idx)])
        decay = float(fcast.d_of(1.0, float(ks[j]), float(ps[j]), np.array([week]))[0])
        dmg = np.clip(dmg0 * decay, 0.0, 1.0)
        out.append(sc0 * (1.0 - strain.damage_matrix(dmg)))
    return out


def _ensemble(nets: list[np.ndarray], gval: float, eis: list[np.ndarray]) -> dict:
    """One simulation per member, each with its own network and its own gain map.

    Each member needs its own feedback inhibition solve, because both the connectivity and
    the gain map differ. That solve is most of the cost, which is what keeps MEMBERS small.
    """
    rates, metas, strengths = [], [], []
    for member, (sc, ei) in enumerate(zip(nets, eis)):
        jj = dmf.fic(sc, gval, ei)
        sim = dmf.simulate(sc, gval, ei=ei, dur_s=intervention.SIM_S, seed=11 + member, j=jj)
        fc = dmf.fc_lin(sc, gval, ei=ei, j=jj)
        strength = (float(dmf.upper(fc).mean()) if np.isfinite(fc).all()
                    else float(dmf.upper(dmf.fc_of(sim["bold"])).mean()))
        rates.append(sim["rate"].mean(axis=0))
        metas.append(float(dmf.metastability(sim["bold"])))
        strengths.append(strength)
    return {"rates": np.asarray(rates), "meta": np.asarray(metas),
            "fc": np.asarray(strengths)}
