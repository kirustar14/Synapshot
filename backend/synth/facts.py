"""The flagship patient, written down once.

Every document in the pack is rendered from this, and so is `expected.json`. That is the
whole point of keeping it here: the answer key and the documents cannot disagree, because
there is only one place either of them could have come from.

Maya Ortiz is invented. The clinical picture is a composite of what the literature
describes for a sport-related concussion with a small contusion: it is plausible, it is
internally consistent, and it is not anybody's records.

The dates are fixed, not relative to today. A bundle whose dates move means the same
records describe a patient who drifts further from their injury every day the demo runs,
and an answer key that has to be regenerated to stay true. Nine days is nine days.
"""

INJURY_DATE = "2026-10-08"
ED_DATE = "2026-10-08"
CT_DATE = "2026-10-08"
LAB_DATE = "2026-10-09"
MRI_DATE = "2026-10-11"
GENETICS_DATE = "2026-10-14"
FOLLOWUP_DATE = "2026-10-17"      # the most recent document: injury + 9 days
DAYS_AGO = 9

MRN = "SYN-004127"
DOB = "2004-03-22"

PATIENT = {
    "name": "Maya Ortiz",
    "age": 22,
    "sex": "female",
    "occupation": "college soccer midfielder",
}

MECHANISM = ("head-to-head collision contesting an aerial ball during a college soccer "
             "match")

VITALS = {"bp": "112/68", "hr": 64, "rr": 14, "temp_c": 36.8, "spo2": 99}

GCS = 15
LOC_SECONDS = 0
AMNESIA_MINUTES = 4

CT_IMPRESSION = ("No acute intracranial haemorrhage, mass effect or midline shift. No "
                 "skull fracture. Study is negative for acute traumatic injury.")

MRI_IMPRESSION = ("Small right frontal cortical contusion measuring 9 x 6 mm with mild "
                  "surrounding oedema. Two small foci of susceptibility in the right "
                  "frontal white matter on SWI, consistent with microhaemorrhage. No "
                  "extra-axial collection.")

CONTUSION = {"side": "right", "lobe": "frontal", "size_mm": "9 x 6"}
SWI_FOCI = 2

# Serum markers, drawn about 24 hours post-injury.
#
# The GFAP and UCH-L1 thresholds are the ALERT-TBI decision cutoffs, 22 and 327 pg/mL
# (Bazarian et al., Lancet Neurology 2018). They are not reference intervals: the study
# combined them into one test for ruling out intracranial injury on CT, so a value above
# one of them is a positive test, not an abnormal result. The documents say that in those
# words. An earlier draft of this file wrote the GFAP cutoff as 100 pg/mL from memory,
# which was wrong by a factor of five.
#
# GFAP here is clearly positive, UCH-L1 sits just under its cutoff, and NfL is not
# informative this early after injury. See docs/RESEARCH.md.
LABS = [
    {"name": "GFAP", "value": 412.0, "unit": "pg/mL",
     "ref": "cutoff 22 (ALERT-TBI)", "flag": "POS"},
    {"name": "UCH-L1", "value": 318.0, "unit": "pg/mL",
     "ref": "cutoff 327 (ALERT-TBI)", "flag": ""},
    {"name": "NfL", "value": 14.2, "unit": "pg/mL", "ref": "see comment", "flag": ""},
    {"name": "S100B", "value": 0.09, "unit": "ug/L", "ref": "see comment", "flag": ""},
]

APOE = "e3/e4"
BDNF = "Val/Met"
COMT = "Val/Met"

GENETICS_NOTE = ("Research panel only. These variants are common, are not diagnostic of "
                 "anything, and do not predict an individual outcome. They are reported "
                 "here because the recovery model uses them as covariates.")

MEDICATIONS = [
    {"name": "ondansetron", "dose": "4 mg", "freq": "PRN nausea", "status": "current"},
    {"name": "acetaminophen", "dose": "500 mg", "freq": "every 6 h PRN", "status": "current"},
    {"name": "amitriptyline", "dose": "10 mg", "freq": "at night", "status": "proposed"},
]

SYMPTOMS = [
    {"name": "headache", "score": 6},
    {"name": "pressure", "score": 4},
    {"name": "neck pain", "score": 3},
    {"name": "nausea", "score": 2},
    {"name": "dizziness", "score": 3},
    {"name": "blurred vision", "score": 2},
    {"name": "light sensitivity", "score": 5},
    {"name": "fatigue", "score": 6},
]

# The handwritten-looking diary page. Day numbers are days since the injury.
DIARY = [
    (1, "Headache bad all day. Slept a lot. Light hurts."),
    (2, "Still sore. Did not go to class."),
    (3, "Better in the morning, worse by evening."),
    (5, "Tried a short walk, felt dizzy after."),
    (7, "Headache about a 5. Reading makes it worse."),
    (9, "Same. Neck still stiff. Tired by 3pm."),
]

REFERRAL_TEXT = [
    "Dear Sports Medicine,",
    "",
    "Thank you for seeing Maya Ortiz, 22, a college soccer midfielder who sustained a",
    "head-to-head collision on 8 October 2026. GCS was 15 throughout with no loss of",
    "consciousness and about four minutes of retrograde amnesia. CT head on the day was",
    "negative. MRI on 11 October showed a small right frontal contusion and two SWI",
    "foci. Serum GFAP was raised at 412 pg/mL.",
    "",
    "She remains symptomatic at day nine, mainly headache, fatigue and light",
    "sensitivity. She is on ondansetron as needed and acetaminophen. I would value your",
    "view on whether a low dose amitriptyline trial is reasonable.",
    "",
    "She has not returned to any training. Please advise on graded return.",
    "",
    "Kind regards,",
    "Dr A. Whitfield, Emergency Medicine",
]

BANNER = "SYNTHETIC RECORD. NOT A REAL PERSON. NOT FOR CLINICAL USE."


def expected() -> dict:
    """The answer key: what a correct extraction should produce from this pack.

    Only fields a reader could actually get from the documents are listed. A field the
    pack does not state is absent from here too, so the score is not punished for
    correctly leaving it empty, and cannot be inflated by guessing it.
    """
    return {
        "_note": "Generated by backend/synth/make_sample.py from backend/synth/facts.py. "
                 "Do not edit by hand: regenerate with `make sample`.",
        "_source_of_truth": "backend/synth/facts.py",
        "name": PATIENT["name"],
        "age": float(PATIENT["age"]),
        "sex": PATIENT["sex"],
        "occupation": PATIENT["occupation"],
        "injury_date": INJURY_DATE,
        "injury_days_ago": float(DAYS_AGO),
        "injury_mechanism": MECHANISM,
        "loc_seconds": float(LOC_SECONDS),
        "gcs": float(GCS),
        "apoe": APOE,
        "bdnf": BDNF,
        "gfap_pg_ml": 412.0,
        "uch_l1_pg_ml": 318.0,
        "nfl_pg_ml": 14.2,
        "ct_finding": CT_IMPRESSION,
        "mri_finding": MRI_IMPRESSION,
        "swi_foci": float(SWI_FOCI),
        "contusion_side": CONTUSION["side"],
        "contusion_lobe": CONTUSION["lobe"],
        "medications": [m["name"] for m in MEDICATIONS],
        "symptoms": [s["name"] for s in SYMPTOMS],
    }
