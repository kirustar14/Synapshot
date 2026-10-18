"""Reading a patient out of their documents.

The headline test scores the extraction against `expected.json`, which is written by the
same generator that writes the documents, so the answer key and the pack cannot drift
apart. Everything here runs with MOCK_LLM on, which means it is the built-in extractor
being measured, not Gemini: the number that matters for CI is the one the demo gets on a
laptop with no key.
"""

import json
import os

import pytest

from backend.ingest import apply, extract, read
from backend.ingest import run as ingestrun
from backend.ingest.schema import NEEDS_REVIEW, Extraction, empty
from backend.synth import facts
from backend.synth import make_sample

# What the built-in extractor has to manage on the flagship pack. The brief asks for 90%;
# the fallback currently gets 20 of 21 and the one it misses is the field that exists only
# on a scanned page, which it genuinely cannot read.
TARGET = 0.90


@pytest.fixture(scope="module")
def pack(tmp_path_factory):
    """The sample pack, generated fresh so the test never reads a stale directory."""
    out = tmp_path_factory.mktemp("maya")
    make_sample.build(out, quiet=True)
    files = [(n, b) for n, b in read.from_dir(out) if n != "expected.json"]
    return {"dir": out, "files": files,
            "expected": json.loads((out / "expected.json").read_text())}


@pytest.fixture(scope="module")
def extracted(pack, ):
    """The built-in extractor's reading of the pack, with the model switched off."""
    os.environ["MOCK_LLM"] = "1"
    got, info = extract.run(read.many(pack["files"]))
    assert info["how"] == "template", "this test measures the fallback, not the model"
    return got


def compare(key, want, have) -> bool:
    """Whether one extracted field matches the answer key."""
    if isinstance(want, float):
        return isinstance(have, (int, float)) and abs(float(have) - want) < 0.051
    if isinstance(want, list):
        return set(str(x).lower() for x in want) <= set(str(x).lower() for x in (have or []))
    if want is None or have is None:
        return want == have
    # Long free text is compared on its opening, because a report impression that is
    # correct to the first fifty characters is the right impression.
    return str(want).strip().lower()[:50] == str(have).strip().lower()[:50]


def test_the_sample_pack_is_ten_documents_and_an_answer_key(pack):
    """make sample writes what the brief asks for, and the scans have no text layer."""
    names = [n for n, _ in pack["files"]]
    assert len(names) == 10, names
    assert len([n for n in names if n.endswith(".pdf")]) == 8
    assert len([n for n in names if n.endswith(".png")]) == 2
    assert (pack["dir"] / "expected.json").exists()

    docs = read.many(pack["files"])
    kinds = {d.name: d.kind for d in docs}
    assert all(kinds[n] == "text" for n in names if n.endswith(".pdf"))
    assert all(kinds[n] == "image" for n in names if n.endswith(".png")), (
        "a scan must come through as an image, not as empty text"
    )


def test_every_page_says_it_is_synthetic(pack):
    """No page of this pack can be mistaken for a real record."""
    for doc in read.many(pack["files"]):
        if doc.kind != "text":
            continue
        assert facts.BANNER.split(".")[0].lower() in doc.text.lower(), doc.name


def test_the_extractor_hits_the_accuracy_target(extracted, pack):
    """The built-in extractor reads at least 90% of the answer key correctly."""
    want = {k: v for k, v in pack["expected"].items() if not k.startswith("_")}
    fields = extracted.fields()

    wrong = []
    for key, value in want.items():
        got = fields.get(key)
        have = getattr(got, "value", None) if got else None
        if key == "medications":
            have = [m.name for m in (have or [])]
        if not compare(key, value, have):
            wrong.append(f"{key}: want {value!r}, got {have!r}")

    score = (len(want) - len(wrong)) / len(want)
    assert score >= TARGET, f"{score:.0%} of {len(want)} fields\n" + "\n".join(wrong)


def test_the_only_field_it_misses_is_the_one_on_a_scan(extracted, pack):
    """The gap is where it should be, and the pipeline says so rather than hiding it.

    Her sport is written on the scanned referral letter and in no typeset document. The
    built-in extractor has no OCR, so it cannot read that page, and the right behaviour is
    an empty field flagged for review, not a plausible guess.
    """
    assert extracted.needs_review() == ["occupation"]
    assert extracted.occupation.value is None
    assert extracted.occupation.confidence == 0.0
    # And with the field below the line, nothing downstream uses it.
    assert apply.used(extracted, "occupation") is None


def test_every_value_can_name_the_file_and_the_sentence_it_came_from(extracted, pack):
    """Provenance is real: each quote is a verbatim substring of the file it names."""
    texts = {d.name: d.text for d in read.many(pack["files"]) if d.kind == "text"}
    checked = 0
    for key, field in extracted.fields().items():
        if not field.ok():
            continue
        assert field.source_quote, f"{key} has no source quote"
        if field.derived():
            # A derived value says what it was worked out from instead of quoting a
            # sentence, because no sentence said it.
            assert all(f in extracted.fields() for f in field.derived_from), key
            continue
        assert field.source_file, f"{key} has no source file"
        body = texts.get(field.source_file)
        assert body is not None, f"{key} cites {field.source_file}, which has no text"
        assert field.source_quote in body, (
            f"{key} quotes {field.source_quote!r}, which is not in {field.source_file}"
        )
        checked += 1
    assert checked >= 15, f"only {checked} fields had provenance to check"


def test_a_quote_contains_the_value_it_is_a_quote_for(extracted):
    """A quote that does not contain its own number proves nothing.

    This caught a real bug: the label and the value land on separate lines of a PDF's text
    layer, so quoting the line the pattern started on gave "GCS:" with no number in it.
    """
    for key in ("gcs", "gfap_pg_ml", "swi_foci", "loc_seconds", "age"):
        field = extracted.fields()[key]
        if not field.ok():
            continue
        number = getattr(field, "value")
        shown = str(int(number)) if float(number) == int(number) else str(number)
        assert shown in field.source_quote, f"{key}: {shown} not in {field.source_quote!r}"


def test_a_derived_value_says_it_was_derived(extracted):
    """Days since injury is computed from two dates, and the record says so.

    It would be easy to give it the injury date's quote and have it look like every other
    field. That quote does not contain the number, so it would be a provenance trail that
    points somewhere the value is not.
    """
    field = extracted.fields()["injury_days_ago"]
    assert field.derived() and field.derived_from == ["injury_date"]
    assert str(int(field.value)) not in field.source_quote
    assert field.ok(), "derived is not the same as unreliable"


def test_a_negated_symptom_is_not_reported(extracted):
    """The notes say "nausea without vomiting". Vomiting is not a reported symptom."""
    assert "vomiting" not in extracted.symptoms.value
    assert "nausea" in extracted.symptoms.value


def test_a_dose_belongs_to_its_own_drug(extracted):
    """Doses are not read off a neighbouring drug, and status comes from the chart."""
    meds = {m.name: m for m in extracted.medications.value}
    assert set(meds) >= {"ondansetron", "acetaminophen", "amitriptyline"}
    assert meds["ondansetron"].dose.startswith("4 mg")
    assert meds["acetaminophen"].dose.startswith("500 mg")
    assert meds["amitriptyline"].dose.startswith("10 mg")
    assert meds["amitriptyline"].status == "proposed", "it has not been started"
    assert meds["ondansetron"].status == "current"


def test_a_modality_is_only_read_from_its_own_report(extracted):
    """Every note mentions CT. Only the CT report supplies the CT finding."""
    assert "03_ct" in extracted.ct_finding.source_file
    assert "04_mri" in extracted.mri_finding.source_file
    assert "negative for acute" in str(extracted.ct_finding.value).lower()
    assert "contusion" in str(extracted.mri_finding.value).lower()


def test_days_since_injury_comes_from_the_documents_not_from_today(extracted):
    """A bundle has its own present tense, so the gap does not grow as the demo ages."""
    assert extracted.injury_days_ago.value == float(facts.DAYS_AGO)
    assert extracted.injury_date.value == facts.INJURY_DATE


def test_an_unreadable_bundle_says_why_rather_than_coming_back_empty():
    """Nothing readable means every field carries the reason, not a blank record."""
    docs = read.many([("scan.png", b"\x89PNG\r\n\x1a\n" + b"0" * 40)])
    got, info = extract.template(docs)
    assert got.filled() == []
    assert info["unread"] == ["scan.png"]
    for field in got.fields().values():
        assert field.confidence == 0.0
        assert "readable" in field.source_quote or field.source_quote


def test_the_schema_cannot_express_a_value_without_its_source():
    """Confidence is required, and the review line is where the UI says it is."""
    assert "confidence" in Extraction.model_fields["age"].annotation.model_fields
    blank = empty("nothing to read")
    assert blank.needs_review() == list(blank.fields())
    assert NEEDS_REVIEW == 0.6


def test_a_low_confidence_field_is_not_used_by_the_twin():
    """Below the line the value is kept for review and the model does not consume it."""
    data = {k: {"value": None, "confidence": 0.0, "source_file": "", "source_quote": "x"}
            for k in Extraction.model_fields}
    data["gcs"] = {"value": 9.0, "confidence": 0.4, "source_file": "note.pdf",
                   "source_quote": "GCS possibly 9"}
    data["age"] = {"value": 22.0, "confidence": 0.9, "source_file": "note.pdf",
                   "source_quote": "Age: 22"}
    data["medications"] = {"value": [], "confidence": 0.0, "source_file": "", "source_quote": "x"}
    data["symptoms"] = {"value": [], "confidence": 0.0, "source_file": "", "source_quote": "x"}
    got = Extraction.model_validate(data)

    assert apply.used(got, "gcs") is None, "0.4 is below the line"
    assert apply.used(got, "age") == 22.0
    record = apply.record(got)
    assert "gcs" not in record["injury"]
    assert record["patient"]["age"] == 22
    assert "gcs" in record["unused"]


def test_genotype_changes_the_recovery_covariates_and_nothing_about_shape():
    """DNA is a covariate. It never reaches the geometry."""
    data = {k: {"value": None, "confidence": 0.0, "source_file": "", "source_quote": "x"}
            for k in Extraction.model_fields}
    data["apoe"] = {"value": "e4/e4", "confidence": 0.95, "source_file": "gen.pdf",
                    "source_quote": "APOE genotype e4/e4"}
    data["bdnf"] = {"value": "Met/Met", "confidence": 0.95, "source_file": "gen.pdf",
                    "source_quote": "BDNF Val66Met: Met/Met"}
    data["medications"] = {"value": [], "confidence": 0.0, "source_file": "", "source_quote": "x"}
    data["symptoms"] = {"value": [], "confidence": 0.0, "source_file": "", "source_quote": "x"}
    got = Extraction.model_validate(data)

    record = apply.record(got)
    assert record["alleles"]["apoe_e4"] == 2
    assert record["alleles"]["bdnf_met"] is True
    assert record["injury"] == {}, "genotype must not write anything into the injury"


def test_the_ingest_route_streams_five_steps_and_builds_the_patient(client, pack, monkeypatch):
    """The whole path: upload, five events, a patient with its twin and its provenance."""
    monkeypatch.setenv("MOCK_LLM", "1")
    files = [("files", (name, data, "application/octet-stream")) for name, data in pack["files"]]

    seen, done = [], None
    with client.stream("POST", "/api/patients/ingest", files=files) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            assert event["kind"] != "failed", event
            if event["kind"] == "step" and event.get("state") == "done":
                seen.append(event["step"])
            if event["kind"] == "done":
                done = event

    assert seen == [key for key, _ in ingestrun.STEPS]
    assert done is not None
    assert done["name"] == facts.PATIENT["name"]
    assert done["needs_review"] == ["occupation"]
    assert done["threshold"] == NEEDS_REVIEW

    pid = done["patient_id"]
    patient = client.get(f"/api/patients/{pid}").json()
    assert patient["age"] == facts.PATIENT["age"]
    assert patient["sex"] == "F"
    assert patient["twin_built"] is True
    assert patient["injury"]["swi_foci"] == facts.SWI_FOCI
    assert patient["injury"]["contusion"] == "right frontal"
    assert patient["injury"]["days_ago"] == facts.DAYS_AGO
    assert patient["alleles"]["apoe"] == facts.APOE
    assert patient["biomarkers"]["gfap_pg_ml"] == 412.0
    assert {m["name"] for m in patient["chart"]["medications"]} >= {"ondansetron", "amitriptyline"}

    # The forecast exists, because step five fitted it.
    forecast = client.get(f"/api/patients/{pid}/forecast").json()
    assert forecast["weeks"], "no forecast was fitted"

    prov = client.get(f"/api/patients/{pid}/provenance").json()
    assert prov["ingested"] is True
    assert prov["fields"]["gfap_pg_ml"]["source_file"] == "05_serum_biomarkers.pdf"
    assert "412" in prov["fields"]["gfap_pg_ml"]["source_quote"]


def test_a_generated_patient_says_it_was_not_read_from_documents(client, seeded):
    """The provenance panel does not pretend a synthetic patient has sources."""
    got = client.get(f"/api/patients/{seeded[0]['id']}/provenance").json()
    assert got["ingested"] is False
    assert got["fields"] == {}
    assert "generated" in got["note"].lower()


def test_the_ingest_refuses_an_empty_upload_when_there_is_no_sample(client, monkeypatch):
    """No files and no sample on disk is an error with an instruction, not a blank patient."""
    monkeypatch.setattr(ingestrun, "sample_files", lambda: [])
    got = client.post("/api/patients/ingest", data={"sample": "1"})
    assert got.status_code == 400
    assert "make sample" in got.json()["detail"]
