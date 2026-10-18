"""Turning an extraction into a patient record the twin can be built from.

This is the join between what the documents said and what the model needs, and it is the
place where the two can disagree. The rules:

- A field below the review line is not used. It is kept with its provenance so the
  workspace can show it greyed, and the model gets the synthetic default instead. A twin
  built partly on a 0.3 confidence guess is worse than one that says it is a template.
- Nothing is invented to fill a gap. Where a document is silent the synthetic bundle's own
  value stands, and `sources` records that the field came from the generator, not a file.
- DNA does not change brain shape. The genotype goes into the recovery rate and nothing
  else, which is the same rule the rest of the twin follows.
"""

import datetime as dt

from .schema import Extraction

# GFAP and UCH-L1 arrive in pg/mL and the twin works in z. These are the same reference
# points backend/data/synthetic.py uses to go the other way, so a real lab number and a
# generated one land on one scale.
#
# They are the generator's internal scale and nothing more. They are NOT a clinical
# reference interval and NOT the ALERT-TBI decision cutoffs, which are 22 pg/mL for GFAP
# and 327 for UCH-L1 (Bazarian et al., Lancet Neurology 2018). A z computed here says
# where a value sits on this model's own axis; it does not say whether a scan is needed.
# See docs/RESEARCH.md, where this is tagged "check this".
GFAP_MEAN, GFAP_SD = 120.0, 60.0
UCHL1_MEAN, UCHL1_SD = 290.0, 140.0

# Where a contusion sits, mapped to the impact directions the strain model knows. A
# contusion is not the impact point (coup and contrecoup), but it is the only localising
# information most reports give, and the alternative is the generator's random guess.
LOBE_HIT = {
    ("left", "temporal"): "temporal_l",
    ("right", "temporal"): "temporal_r",
    ("left", "frontal"): "frontal",
    ("right", "frontal"): "frontal",
    ("left", "parietal"): "parietal",
    ("right", "parietal"): "parietal",
    ("left", "occipital"): "occipital",
    ("right", "occipital"): "occipital",
}

SEX_SHORT = {"female": "F", "f": "F", "male": "M", "m": "M"}


def used(got: Extraction, key: str):
    """A field's value if it is confident enough to use, else None."""
    field = got.fields().get(key)
    if field is None or not field.ok():
        return None
    return getattr(field, "value", None)


def apoe_e4(call: str | None) -> int | None:
    """Number of e4 alleles from an APOE genotype string."""
    if not call:
        return None
    return str(call).lower().count("e4")


def bdnf_met(call: str | None) -> bool | None:
    """True when at least one Met allele is present at BDNF Val66Met."""
    if not call:
        return None
    return "met" in str(call).lower()


def days_ago(got: Extraction) -> int | None:
    """Days since the injury, from the stated gap or from the date."""
    gap = used(got, "injury_days_ago")
    if gap is not None:
        return max(0, int(round(float(gap))))
    date = used(got, "injury_date")
    if not date:
        return None
    try:
        when = dt.date.fromisoformat(str(date)[:10])
    except ValueError:
        return None
    return max(0, (dt.date.today() - when).days)


def record(got: Extraction) -> dict:
    """Patient fields and a per-field note of where each one came from.

    Returns {"patient": {...}, "injury": {...}, "alleles": {...}, "biomarkers": {...},
    "sources": {...}, "unused": [...]}. Anything absent is left out entirely so the
    caller can fall back to the synthetic bundle for it rather than write a None.
    """
    out: dict = {"patient": {}, "injury": {}, "alleles": {}, "biomarkers": {},
                 "sources": {}, "unused": got.needs_review()}

    def note(key: str) -> None:
        field = got.fields().get(key)
        if field is None:
            return
        out["sources"][key] = {"confidence": round(float(field.confidence), 2),
                               "source_file": field.source_file,
                               "source_quote": field.source_quote,
                               "derived_from": list(field.derived_from)}

    name = used(got, "name")
    if name:
        out["patient"]["name"] = str(name).strip()
        note("name")
    age = used(got, "age")
    if age is not None:
        out["patient"]["age"] = int(round(float(age)))
        note("age")
    sex = used(got, "sex")
    if sex:
        short = SEX_SHORT.get(str(sex).strip().lower())
        if short:
            out["patient"]["sex"] = short
            note("sex")

    mech = used(got, "injury_mechanism")
    if mech:
        out["injury"]["mechanism"] = str(mech).strip()[:80]
        note("injury_mechanism")
    date = used(got, "injury_date")
    if date:
        out["injury"]["date"] = str(date)[:10]
        note("injury_date")
    loc = used(got, "loc_seconds")
    if loc is not None:
        out["injury"]["loc"] = bool(float(loc) > 0)
        out["injury"]["loc_seconds"] = float(loc)
        note("loc_seconds")
    gcs = used(got, "gcs")
    if gcs is not None:
        out["injury"]["gcs"] = int(round(float(gcs)))
        note("gcs")

    side = (used(got, "contusion_side") or "").strip().lower()
    lobe = (used(got, "contusion_lobe") or "").strip().lower()
    hit = LOBE_HIT.get((side, lobe))
    if hit:
        out["injury"]["location"] = hit
        out["injury"]["contusion"] = f"{side} {lobe}"
        note("contusion_side")
        note("contusion_lobe")

    for key in ("ct_finding", "mri_finding"):
        val = used(got, key)
        if val:
            out["injury"][key] = str(val)[:300]
            note(key)
    foci = used(got, "swi_foci")
    if foci is not None:
        out["injury"]["swi_foci"] = int(round(float(foci)))
        note("swi_foci")

    e4 = apoe_e4(used(got, "apoe"))
    if e4 is not None:
        out["alleles"]["apoe_e4"] = int(e4)
        out["alleles"]["apoe"] = str(used(got, "apoe"))
        note("apoe")
    met = bdnf_met(used(got, "bdnf"))
    if met is not None:
        out["alleles"]["bdnf_met"] = bool(met)
        out["alleles"]["bdnf"] = str(used(got, "bdnf"))
        note("bdnf")

    gfap = used(got, "gfap_pg_ml")
    if gfap is not None:
        out["biomarkers"]["gfap_pg_ml"] = float(gfap)
        out["biomarkers"]["gfap_z"] = round((float(gfap) - GFAP_MEAN) / GFAP_SD, 2)
        note("gfap_pg_ml")
    uchl1 = used(got, "uch_l1_pg_ml")
    if uchl1 is not None:
        out["biomarkers"]["uchl1_pg_ml"] = float(uchl1)
        out["biomarkers"]["uchl1_z"] = round((float(uchl1) - UCHL1_MEAN) / UCHL1_SD, 2)
        note("uch_l1_pg_ml")
    nfl = used(got, "nfl_pg_ml")
    if nfl is not None:
        # No z mapping for NfL: there is no reference in the generator to invert against,
        # and inventing one would put a made up number on a clinical scale. Carried as the
        # raw value so the Data tab can show it and the model does not use it.
        out["biomarkers"]["nfl_pg_ml"] = float(nfl)
        note("nfl_pg_ml")

    meds = used(got, "medications") or []
    if meds:
        out["patient"]["medications"] = [m.model_dump() if hasattr(m, "model_dump") else dict(m)
                                         for m in meds]
        note("medications")
    sym = used(got, "symptoms") or []
    if sym:
        out["patient"]["reported_symptoms"] = [str(s) for s in sym]
        note("symptoms")

    gap = days_ago(got)
    if gap is not None:
        out["injury"]["days_ago"] = gap

    occupation = used(got, "occupation")
    if occupation:
        out["patient"]["occupation"] = str(occupation).strip()[:80]
        note("occupation")

    return out
