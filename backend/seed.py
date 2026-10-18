"""Build the synthetic cohort and the demo patients, then fit the population layer.

Run with `make seed`. Prints the final coverage number and the parameter recovery table.
"""

import time

import numpy as np

from . import db, demo
from .data import synthetic as syn
from .twin import enkf, population

COHORT = 50
WEEKS = 12


def run_cohort(size: int = COHORT, weeks: int = WEEKS, quiet: bool = False) -> dict:
    """Generate `size` patients, run the EnKF over 12 weeks, return the rows for the fit."""
    eff = syn.cohort_effects()
    rows, cover = [], []
    for i in range(size):
        pat = syn.make_patient(2000 + i, eff=eff)
        geno = pat["alleles"]
        zbio = float(pat["zbio"])
        state = enkf.init(np.random.default_rng(3000 + i), geno, zbio, pat["sex"], pat["d0_true"])
        for w in range(weeks + 1):
            out = enkf.step(state, w, pat["truth"][w], flash_ok=True, seed=i)
            if np.isfinite(out["cov"]):
                cover.append({"week": w, "cov": out["cov"]})
        post = enkf.params(state)
        rows.append({
            "seed": pat["seed"],
            "logk_hat": post["logk_mean"],
            "se_logk": post["logk_sd"],
            "logitp_hat": post["logitp_mean"],
            "se_logitp": post["logitp_sd"],
            "e4": geno["apoe_e4"],
            "sex": pat["sex"],
            "met": geno["bdnf_met"],
            "zbio": zbio,
            "k_true": pat["params_true"]["k"],
            "k_est": post["k"],
            "coverage": enkf.mean_coverage(state),
            "contraction": state["contraction"]["k"],
        })
        if not quiet and (i + 1) % 10 == 0:
            print(f"  cohort {i + 1}/{size}")
    return {"rows": rows, "coverage": cover, "eff": eff}


def mean_by_week(cover: list[dict]) -> list[dict]:
    """Average coverage per week across the cohort."""
    acc: dict[int, list[float]] = {}
    for c in cover:
        acc.setdefault(int(c["week"]), []).append(float(c["cov"]))
    return [{"week": w, "cov": float(np.mean(v))} for w, v in sorted(acc.items())]


def build(size: int = COHORT, weeks: int = WEEKS, quiet: bool = False) -> dict:
    """Full seed: cohort, population fit, cohort.json, demo patients."""
    t0 = time.time()
    db.conn()
    if not quiet:
        print(f"building {size} synthetic cohort patients over {weeks} weeks")
    got = run_cohort(size, weeks, quiet)
    cover = mean_by_week(got["coverage"])
    if not quiet:
        print(f"population layer, {len(got['rows'])} patients")
    fitted = population.fit(got["rows"], seed=5)
    cohort = population.cohort_json(got["rows"], cover, got["eff"], fitted)
    population.save(cohort)

    if not quiet:
        print("demo patients")
    demo.reset(quiet=quiet)

    # Clinics and clinician accounts are part of the seed now, not a separate step. The
    # demo reset has already tried to assign, but on a brand new database there was no
    # team to assign to yet.
    from . import team

    made = team.ensure_demo()
    if not quiet:
        print(f"team: {made['clinicians_created']} clinicians created, "
              f"{made['assignments']} assignments")

    secs = time.time() - t0
    report(cohort, got, fitted, secs, quiet)
    return {"cohort": cohort, "fitted": fitted, "seconds": secs}


def report(cohort: dict, got: dict, fitted: dict, secs: float, quiet: bool = False) -> None:
    """Print the coverage number and the parameter recovery table."""
    if quiet:
        return
    cov8 = [c["cov"] for c in cohort["coverage"] if c["week"] == 8]
    final = cohort["coverage"][-1]["cov"] if cohort["coverage"] else float("nan")
    contr = float(np.mean([r["contraction"] for r in got["rows"]]))
    kt = np.array(cohort["k_true"])
    ke = np.array(cohort["k_est"])
    corr = float(np.corrcoef(kt, ke)[0, 1]) if len(kt) > 2 else float("nan")

    print("")
    print(f"cohort size            {cohort['size']}")
    print(f"coverage at week 8     {cov8[0] if cov8 else float('nan'):.3f}   target 0.65 to 0.9")
    print(f"coverage at last week  {final:.3f}")
    print(f"contraction of log k   {contr:.3f}   target above 0.3 by week 6")
    print(f"k true against k est   r = {corr:.3f}")
    print(f"population fit by      {fitted['how']}")
    print("")
    print("parameter recovery")
    print(f"  {'name':8s} {'true':>8s} {'est':>8s} {'lo':>8s} {'hi':>8s}  inside")
    for row in cohort["effects"]:
        ok = "yes" if row["lo"] <= row["true"] <= row["hi"] else "NO"
        print(f"  {row['name']:8s} {row['true']:8.3f} {row['est']:8.3f} {row['lo']:8.3f} {row['hi']:8.3f}  {ok}")
    for nm in ("mu_k", "mu_p", "s_k", "s_p"):
        got_nm = fitted["params"].get(nm)
        if got_nm:
            print(f"  {nm:8s} {'':>8s} {got_nm['est']:8.3f} {got_nm['lo']:8.3f} {got_nm['hi']:8.3f}")
    print("")
    print(f"seed finished in {secs:.1f} s")


if __name__ == "__main__":
    build()
