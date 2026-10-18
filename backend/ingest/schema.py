"""The extraction schema. One shape, used by the model, the fallback and the UI.

Every extracted field is a value plus its provenance: how confident the extractor was,
which file it came from, and the sentence it was read out of. There is deliberately no way
to express a value without those, because a field with no source is a field somebody has
to go and check by hand anyway, and this screen should say so rather than look certain.

NEEDS_REVIEW is the line. Below it the workspace shows the field greyed with "needs
review" next to it, and the twin does not use it. It is 0.6 because that is where a model
that is guessing from a plausible-looking sentence starts to be more wrong than right; it
is a judgement call, written down here so it can be argued with.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

NEEDS_REVIEW = 0.6

# APOE alleles the genotype layer knows about. Anything else is not a valid APOE call.
APOE = ["e2/e2", "e2/e3", "e2/e4", "e3/e3", "e3/e4", "e4/e4"]
BDNF = ["Val/Val", "Val/Met", "Met/Met"]


class Source(BaseModel):
    """Where a value came from, and how sure the extractor was."""

    confidence: float = Field(ge=0.0, le=1.0, description=(
        "0 to 1. Use below 0.6 when the document does not actually say this and you are "
        "inferring it. Use 0 when the value is absent from every document."
    ))
    source_file: str = Field(default="", description="The file name the value was read from.")
    source_quote: str = Field(default="", description=(
        "The sentence or line from that file, copied exactly, that contains the value. "
        "Empty only when confidence is 0."
    ))
    derived_from: list[str] = Field(default_factory=list, description=(
        "Other field names this value was worked out from, when no document states it "
        "directly. Set this instead of inventing a quote: a value computed from two dates "
        "is not something any sentence said, and the screen shows it as derived."
    ))

    def derived(self) -> bool:
        """True when this value was computed rather than read."""
        return bool(self.derived_from)

    def ok(self) -> bool:
        """True when this field is confident enough to be used rather than reviewed."""
        return self.confidence >= NEEDS_REVIEW and bool(self.source_file or self.derived_from)


class Txt(Source):
    """A short text value."""

    value: str | None = None


class Num(Source):
    """A numeric value."""

    value: float | None = None


class Lst(Source):
    """A list of short strings, for example symptom names.

    Lower-cased on the way in. Downstream these are matched against fixed vocabularies,
    and "Headache" and "headache" are the same symptom; normalising once here is better
    than every consumer remembering to casefold.
    """

    value: list[str] = Field(default_factory=list)

    @field_validator("value")
    @classmethod
    def _fold(cls, got: list[str]) -> list[str]:
        out = []
        for item in got:
            low = str(item).strip().lower()
            if low and low not in out:
                out.append(low)
        return out


class Med(BaseModel):
    """One medication as it is written in the chart.

    The name is lower-cased because that is a lookup key: the formulary is keyed on it and
    a drug written "Amitriptyline" in one note and "amitriptyline" in another is one drug.
    The dose is never touched. It is shown back to a clinician exactly as the chart wrote
    it, and nothing parses it, because a dose that has been through a regex is a dose
    somebody could be wrong about on this screen.
    """

    name: str
    dose: str = Field(default="", description="Exactly as written. Never interpreted.")
    status: Literal["current", "proposed", "stopped", "unknown"] = "unknown"

    @field_validator("name")
    @classmethod
    def _fold(cls, got: str) -> str:
        return str(got).strip().lower()


class Meds(Source):
    """The medication list."""

    value: list[Med] = Field(default_factory=list)


class Extraction(BaseModel):
    """Everything the ingest tries to read out of a document bundle.

    The field names match the patient record, so nothing has to be translated between
    this and the database, and a new field cannot be added in one place only.
    """

    name: Txt
    age: Num
    sex: Txt
    occupation: Txt = Field(description="Sport, job or school, as the chart describes it.")

    injury_date: Txt = Field(description="ISO date if the document gives one, else what it says.")
    injury_days_ago: Num = Field(description="Days between the injury and the most recent document date.")
    injury_mechanism: Txt
    loc_seconds: Num = Field(description="Loss of consciousness in seconds. 0 if the chart says none.")
    gcs: Num = Field(description="Glasgow Coma Scale total, 3 to 15.")

    apoe: Txt = Field(description=f"One of {APOE}, exactly. Null if no APOE result is present.")
    bdnf: Txt = Field(description=f"BDNF Val66Met genotype, one of {BDNF}. Null if absent.")
    gfap_pg_ml: Num = Field(description="Serum GFAP in pg/mL.")
    uch_l1_pg_ml: Num = Field(description="Serum UCH-L1 in pg/mL.")
    nfl_pg_ml: Num = Field(description="Serum neurofilament light in pg/mL.")

    ct_finding: Txt = Field(description="What the CT report concluded, in its own words.")
    mri_finding: Txt = Field(description="What the MRI report concluded, in its own words.")
    swi_foci: Num = Field(description="Number of microhaemorrhage foci on SWI.")
    contusion_side: Txt = Field(description="left, right or null.")
    contusion_lobe: Txt = Field(description="frontal, temporal, parietal, occipital or null.")

    medications: Meds
    symptoms: Lst = Field(description="Symptoms named in the notes, lower case.")

    def fields(self) -> dict[str, Source]:
        """Every extracted field by name, for scoring and for the provenance panel."""
        out: dict[str, Source] = {}
        for key in type(self).model_fields:
            got = getattr(self, key)
            if isinstance(got, Source):
                out[key] = got
        return out

    def needs_review(self) -> list[str]:
        """Field names whose confidence is below the line, in schema order."""
        return [k for k, v in self.fields().items() if not v.ok()]

    def filled(self) -> list[str]:
        """Field names that actually got a value."""
        out = []
        for key, got in self.fields().items():
            val = getattr(got, "value", None)
            if val is None or val == [] or val == "":
                continue
            out.append(key)
        return out


def empty(reason: str = "") -> Extraction:
    """An extraction with nothing in it, for when no file could be read at all.

    Every field is confidence 0 with the reason as its quote, so the screen says why it is
    empty instead of showing a blank record that looks like a clean read.
    """
    blank = {"confidence": 0.0, "source_file": "", "source_quote": reason}
    data: dict = {}
    for key, info in Extraction.model_fields.items():
        ann = info.annotation
        if ann is Lst or ann is Meds:
            data[key] = {**blank, "value": []}
        else:
            data[key] = {**blank, "value": None}
    return Extraction.model_validate(data)
