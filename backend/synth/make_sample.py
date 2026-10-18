"""Write the flagship patient's document pack. Run with `make sample`.

Ten files into backend/data/sample/maya_ortiz: eight PDFs typeset with reportlab and two
PNGs that look like they came off a departmental scanner, plus expected.json.

The two scans exist because real document bundles contain them and a pipeline that only
works on clean text is not a pipeline that works. They have no text layer, so pypdf and
the regex extractor get nothing out of them at all.

One field is reachable only through them: her sport is stated on the scanned referral
letter and nowhere else. With a key, Gemini reads the image and gets it. Without one, that
field comes back at confidence zero and the workspace shows it as needing review. Every
other field is in at least one typeset PDF, so the pack scores 21 of 21 either way apart
from that one. That gap is the point of the scans and it is deliberate.

Seeded. The scanner noise, the speckles and the skew are the same every run, so a diff of
this directory is empty unless the facts changed.
"""

import json
import sys
from pathlib import Path

from ..config import ROOT
from . import facts

OUT = ROOT / "backend" / "data" / "sample" / "maya_ortiz"
SEED = 4127

# Page furniture, in points. US Letter, because that is what a US clinic prints.
PAGE = (612.0, 792.0)
MARGIN = 54.0


def canvas_for(path: Path):
    """A reportlab canvas for one page, with the synthetic banner already on it."""
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas as rl

    cv = rl.Canvas(str(path), pagesize=letter)
    cv.setTitle(path.stem.replace("_", " "))
    cv.setAuthor("Synapshot synthetic record generator")
    cv.setSubject(facts.BANNER)
    return cv


class Page:
    """A cursor down a PDF page, so each document reads as a sequence of lines.

    reportlab is a drawing API: every call needs a y. Tracking that by hand in eight
    documents is how a line ends up on top of another one, so the cursor lives here and
    the documents below only say what to write.
    """

    def __init__(self, path: Path, heading: str, dept: str):
        self.cv = canvas_for(path)
        self.y = PAGE[1] - MARGIN
        self.banner()
        self.title(heading, dept)

    def banner(self) -> None:
        from reportlab.lib.colors import HexColor

        self.cv.setFillColor(HexColor("#b45309"))
        self.cv.setFont("Helvetica-Bold", 7.5)
        self.cv.drawString(MARGIN, PAGE[1] - 30, facts.BANNER)
        self.cv.setStrokeColor(HexColor("#d97706"))
        self.cv.setLineWidth(0.6)
        self.cv.rect(MARGIN - 8, PAGE[1] - 38, PAGE[0] - 2 * (MARGIN - 8), 18, stroke=1, fill=0)
        self.cv.setFillColor(HexColor("#111827"))
        self.y = PAGE[1] - 64

    def title(self, heading: str, dept: str) -> None:
        self.cv.setFont("Helvetica-Bold", 15)
        self.cv.drawString(MARGIN, self.y, heading)
        self.y -= 15
        self.cv.setFont("Helvetica", 9)
        self.cv.drawString(MARGIN, self.y, dept)
        self.y -= 6
        self.rule()
        self.y -= 12

    def rule(self) -> None:
        from reportlab.lib.colors import HexColor

        self.cv.setStrokeColor(HexColor("#9ca3af"))
        self.cv.setLineWidth(0.5)
        self.cv.line(MARGIN, self.y, PAGE[0] - MARGIN, self.y)

    def section(self, name: str) -> None:
        self.y -= 10
        self.cv.setFont("Helvetica-Bold", 10)
        self.cv.drawString(MARGIN, self.y, name.upper())
        self.y -= 13

    def line(self, text: str, bold: bool = False, size: float = 9.5) -> None:
        self.cv.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        self.cv.drawString(MARGIN, self.y, text)
        self.y -= size + 3.5

    def field(self, label: str, value: str) -> None:
        """A label and a value on one row, which is what these documents are made of."""
        self.cv.setFont("Helvetica-Bold", 9.5)
        self.cv.drawString(MARGIN, self.y, f"{label}:")
        self.cv.setFont("Helvetica", 9.5)
        self.cv.drawString(MARGIN + 132, self.y, value)
        self.y -= 13

    def wrap(self, text: str, width: int = 96, size: float = 9.5) -> None:
        """Paragraph text, wrapped on words.

        Wrapping matters to the extractor: `source_quote` is copied out of the text layer,
        and where this breaks a line is where a quote will break. It does not break inside
        a number or a unit.
        """
        import textwrap

        for row in textwrap.wrap(text, width=width) or [""]:
            self.line(row, size=size)

    def footer(self, who: str) -> None:
        from reportlab.lib.colors import HexColor

        self.cv.setFillColor(HexColor("#6b7280"))
        self.cv.setFont("Helvetica", 7.5)
        self.cv.drawString(MARGIN, MARGIN - 12,
                           f"{who}  |  MRN {facts.MRN}  |  {facts.BANNER}")
        self.cv.setFillColor(HexColor("#111827"))

    def header_block(self, date: str) -> None:
        """The patient identity block every document in a real chart repeats."""
        self.field("Patient name", facts.PATIENT["name"])
        self.field("MRN", facts.MRN)
        self.field("Date of birth", f"{facts.DOB}  (age {facts.PATIENT['age']})")
        self.field("Sex", facts.PATIENT["sex"].capitalize())
        self.field("Document date", date)

    def save(self, who: str) -> None:
        self.footer(who)
        self.cv.showPage()
        self.cv.save()


# ---------------------------------------------------------------- the eight PDFs

def ed_triage(path: Path) -> None:
    pg = Page(path, "Emergency Department Triage Note", "Riverside University Hospital, Emergency Medicine")
    pg.header_block(facts.ED_DATE)
    pg.section("Presenting complaint")
    pg.wrap("Head injury during sport. Brought in by the team physiotherapist.")
    pg.section("Mechanism of injury")
    pg.field("Date of injury", facts.INJURY_DATE)
    pg.wrap(f"Mechanism: {facts.MECHANISM}.")
    pg.field("Loss of consciousness", f"{facts.LOC_SECONDS} seconds (witnessed, none)")
    pg.field("Retrograde amnesia", f"approximately {facts.AMNESIA_MINUTES} minutes")
    pg.field("Helmet or headgear", "none worn")
    pg.section("Observations on arrival")
    pg.field("GCS", f"{facts.GCS} (E4 V5 M6)")
    pg.field("Blood pressure", f"{facts.VITALS['bp']} mmHg")
    pg.field("Heart rate", f"{facts.VITALS['hr']} bpm")
    pg.field("Respiratory rate", f"{facts.VITALS['rr']} /min")
    pg.field("Temperature", f"{facts.VITALS['temp_c']} C")
    pg.field("Oxygen saturation", f"{facts.VITALS['spo2']}% on air")
    pg.field("Pupils", "equal and reactive, 3 mm")
    pg.section("Triage category")
    pg.wrap("Category 3. For physician review and CT head per the Canadian CT Head Rule "
            "given the witnessed mechanism and persisting headache.")
    pg.save("Triage nurse: J. Okonkwo, RN")


def ed_physician(path: Path) -> None:
    pg = Page(path, "Emergency Physician Note", "Riverside University Hospital, Emergency Medicine")
    pg.header_block(facts.ED_DATE)
    pg.section("History")
    # Her sport is deliberately not written here. It is stated only on the scanned
    # referral letter, which has no text layer, so without a model that can read an image
    # the occupation field comes back at confidence zero and the workspace shows it as
    # needing review. That is the honest behaviour of this pipeline on a real bundle, and
    # a demo where every field always resolves would never show it.
    pg.wrap(f"{facts.PATIENT['name']} is a {facts.PATIENT['age']} year old woman. "
            f"She sustained a "
            f"{facts.MECHANISM} today. She did not lose consciousness. She recalls "
            "walking off the pitch but not the minutes immediately before the collision. "
            "She describes immediate headache, a feeling of pressure in the head, and "
            "nausea without vomiting. No seizure. No neck pain on movement initially, "
            "now reports stiffness.")
    pg.section("Past history")
    pg.wrap("No previous concussion. No migraine. No anticoagulation. No regular "
            "medication. No known drug allergy.")
    pg.section("Examination")
    pg.field("GCS", str(facts.GCS))
    pg.wrap("Alert and orientated. Cranial nerves intact. Power 5/5 throughout, normal "
            "tone and reflexes. Coordination intact. Gait steady. No focal neurological "
            "deficit. Cervical spine non-tender midline, full range of movement. No "
            "scalp haematoma or laceration.")
    pg.section("Impression")
    pg.wrap("Sport-related concussion. CT head requested. No red flag features at "
            "present: no repeated vomiting, no seizure, no focal deficit, no "
            "deteriorating consciousness.")
    pg.section("Plan")
    pg.line("1. CT head without contrast.")
    pg.line("2. Serum biomarker panel in the morning for the research protocol.")
    pg.line("3. Ondansetron 4 mg as needed for nausea.")
    pg.line("4. Acetaminophen 500 mg every six hours as needed for headache.")
    pg.line("5. No return to training. Refer to Sports Medicine for graded return.")
    pg.line("6. Written head injury advice given to patient and to the team physio.")
    pg.save("Dr A. Whitfield, Emergency Medicine")


def ct_report(path: Path) -> None:
    pg = Page(path, "CT Head Report", "Riverside University Hospital, Department of Radiology")
    pg.header_block(facts.CT_DATE)
    pg.field("Examination", "CT head without intravenous contrast")
    pg.field("Clinical indication", "Head injury during sport, persisting headache")
    pg.section("Technique")
    pg.wrap("Axial non-contrast acquisition from the skull base to the vertex. 0.625 mm "
            "collimation, reconstructed at 2.5 mm in axial, coronal and sagittal planes. "
            "Bone algorithm reconstructions reviewed.")
    pg.section("Findings")
    pg.wrap("No extra-axial collection. No intraparenchymal haemorrhage. Grey-white "
            "differentiation is preserved. Ventricles and basal cisterns are normal in "
            "size and configuration. No midline shift. No depressed or linear skull "
            "fracture on bone windows. Paranasal sinuses and mastoid air cells are clear.")
    pg.section("Impression")
    pg.wrap(facts.CT_IMPRESSION)
    pg.y -= 6
    pg.wrap("Note: a negative CT does not exclude concussion, and does not exclude "
            "microstructural injury. MRI is more sensitive and has been requested.",
            size=9.0)
    pg.save("Reported by Dr S. Nakamura, Consultant Radiologist")


def mri_report(path: Path) -> None:
    pg = Page(path, "MRI Brain Report", "Riverside University Hospital, Department of Radiology")
    pg.header_block(facts.MRI_DATE)
    pg.field("Examination", "MRI brain, trauma protocol")
    pg.field("Clinical indication", "Sport-related concussion day 3, CT negative, persisting symptoms")
    pg.section("Technique")
    pg.wrap("3T. Sagittal 3D T1 MPRAGE, axial T2, axial FLAIR, axial DWI with ADC, "
            "axial susceptibility weighted imaging (SWI), coronal T2. No contrast.")
    pg.section("Findings")
    pg.wrap(f"There is a small cortical contusion in the {facts.CONTUSION['side']} "
            f"{facts.CONTUSION['lobe']} lobe, in the inferior frontal gyrus, measuring "
            f"{facts.CONTUSION['size_mm']} mm, with mild surrounding T2 and FLAIR "
            "hyperintensity consistent with oedema. No restricted diffusion.")
    pg.wrap(f"SWI demonstrates {facts.SWI_FOCI} small foci of susceptibility in the "
            f"{facts.CONTUSION['side']} {facts.CONTUSION['lobe']} subcortical white "
            "matter, measuring 2 mm and 3 mm, consistent with traumatic "
            "microhaemorrhage. No foci elsewhere, in particular none at the "
            "grey-white junction of the temporal lobes or in the brainstem.")
    pg.wrap("No extra-axial collection. No mass effect. Corpus callosum is intact and "
            "normal in signal. No hydrocephalus. Vascular flow voids are preserved in "
            "the dural venous sinuses.")
    pg.section("Impression")
    pg.wrap(facts.MRI_IMPRESSION)
    pg.save("Reported by Dr S. Nakamura, Consultant Radiologist")


def lab_report(path: Path) -> None:
    pg = Page(path, "Serum Biomarker Panel", "Riverside University Hospital, Clinical Biochemistry")
    pg.header_block(facts.LAB_DATE)
    pg.field("Collected", f"{facts.LAB_DATE} 07:40, approximately 22 hours post-injury")
    pg.field("Specimen", "Serum, gel separator tube")
    pg.field("Requested by", "Emergency Medicine, research protocol SYN-TBI-02")
    pg.section("Results")
    pg.cv.setFont("Helvetica-Bold", 9.5)
    pg.cv.drawString(MARGIN, pg.y, "Analyte")
    pg.cv.drawString(MARGIN + 150, pg.y, "Result")
    pg.cv.drawString(MARGIN + 240, pg.y, "Unit")
    pg.cv.drawString(MARGIN + 320, pg.y, "Reference")
    pg.cv.drawString(MARGIN + 430, pg.y, "Flag")
    pg.y -= 6
    pg.rule()
    pg.y -= 12
    for row in facts.LABS:
        pg.cv.setFont("Helvetica", 9.5)
        pg.cv.drawString(MARGIN, pg.y, row["name"])
        pg.cv.setFont("Helvetica-Bold" if row["flag"] else "Helvetica", 9.5)
        pg.cv.drawString(MARGIN + 150, pg.y, f"{row['value']}")
        pg.cv.setFont("Helvetica", 9.5)
        pg.cv.drawString(MARGIN + 240, pg.y, row["unit"])
        pg.cv.drawString(MARGIN + 320, pg.y, row["ref"])
        pg.cv.drawString(MARGIN + 430, pg.y, row["flag"] or "-")
        pg.y -= 13
    pg.y -= 4
    pg.rule()
    pg.section("Comment")
    pg.wrap("The GFAP and UCH-L1 figures quoted are the ALERT-TBI decision cutoffs of 22 "
            "and 327 pg/mL, not reference intervals. That study combined the two into a "
            "single test for ruling out intracranial injury on CT, so a value above a "
            "cutoff is a positive test rather than an abnormal result.")
    pg.wrap("GFAP is positive at 412 pg/mL. UCH-L1 at 318 pg/mL is just below its "
            "cutoff. NfL rises later after injury, so a value in range at 22 hours is "
            "not reassuring on its own. S100B is not specific to brain and is affected "
            "by extracranial injury.")
    pg.wrap("These assays are used here as research covariates. They are not diagnostic "
            "and no clinical decision should rest on them.")
    pg.save("Authorised by Dr P. Lindqvist, Clinical Biochemistry")


def genetics_report(path: Path) -> None:
    pg = Page(path, "Research Genotyping Report", "Riverside University Hospital, Research Genomics Laboratory")
    pg.header_block(facts.GENETICS_DATE)
    pg.field("Panel", "TBI recovery covariate panel, 4 loci")
    pg.field("Method", "TaqMan allelic discrimination, confirmed by Sanger sequencing")
    pg.field("Consent", "Research consent on file. Genetic box ticked separately.")
    pg.section("Results")
    pg.field("APOE genotype", facts.APOE)
    pg.field("BDNF Val66Met (rs6265)", facts.BDNF)
    pg.field("COMT Val158Met (rs4680)", facts.COMT)
    pg.field("Call rate", "100% across all assayed loci")
    pg.section("Interpretation")
    pg.wrap(facts.GENETICS_NOTE)
    pg.wrap("Approximately a quarter of people carry at least one APOE e4 allele, and "
            "about a third carry a BDNF Met allele. Neither is rare and neither is "
            "actionable on its own.")
    pg.section("Limitations")
    pg.wrap("This panel reads four positions. Nothing else in the sample was examined, "
            "and the sample is destroyed after reporting per protocol. No incidental "
            "findings are possible from a targeted assay of this kind.")
    pg.save("Reported by Dr R. Adeyemi, Clinical Scientist")


def followup_note(path: Path) -> None:
    pg = Page(path, "Sports Medicine Follow-up", "Riverside University Hospital, Sport and Exercise Medicine")
    pg.header_block(facts.FOLLOWUP_DATE)
    pg.field("Days since injury", f"{facts.DAYS_AGO}")
    pg.section("Interval history")
    pg.wrap("Seen at day nine. She remains symptomatic. Headache is the dominant "
            "complaint, worse with reading and screen work, better with rest in a dark "
            "room. Fatigue by mid-afternoon. Light sensitivity persists. Nausea has "
            "largely settled on ondansetron as needed. Sleep is broken. No new "
            "neurological symptoms, no vomiting, no seizure.")
    pg.section("Symptom scores, 0 to 10")
    for row in facts.SYMPTOMS:
        pg.field(row["name"].capitalize(), str(row["score"]))
    pg.field("Total", str(sum(r["score"] for r in facts.SYMPTOMS)))
    pg.section("Examination")
    pg.wrap("Smooth pursuit provokes headache. Near point of convergence 11 cm, which is "
            "receded. Vestibulo-ocular reflex testing provokes dizziness. Cervical spine "
            "has reduced rotation to the left with paraspinal tenderness. Balance on "
            "tandem stance is intact. No focal deficit.")
    pg.section("Plan")
    pg.line("1. Continue acetaminophen 500 mg as needed. Avoid daily analgesia.")
    pg.line("2. Continue ondansetron 4 mg as needed for nausea.")
    pg.line("3. Consider amitriptyline 10 mg at night for headache and sleep. Discussed")
    pg.line("   with patient, to start if headache persists past day fourteen.")
    pg.line("4. Cervical physiotherapy referral.")
    pg.line("5. Weekly remote check-in enrolled on the research protocol.")
    pg.line("6. No return to contact training. Graded return not yet started.")
    pg.save("Dr N. Farah, Sport and Exercise Medicine")


def medication_list(path: Path) -> None:
    pg = Page(path, "Medication Reconciliation", "Riverside University Hospital, Pharmacy")
    pg.header_block(facts.FOLLOWUP_DATE)
    pg.section("Current medication")
    for med in facts.MEDICATIONS:
        if med["status"] != "current":
            continue
        pg.field(med["name"].capitalize(), f"{med['dose']}, {med['freq']}")
    pg.section("Proposed, not yet started")
    for med in facts.MEDICATIONS:
        if med["status"] != "proposed":
            continue
        pg.field(med["name"].capitalize(), f"{med['dose']}, {med['freq']}")
    pg.section("Stopped")
    pg.line("None.")
    pg.section("Allergies")
    pg.line("No known drug allergy.")
    pg.section("Pharmacist note")
    pg.wrap("Doses are recorded exactly as prescribed. Advised against daily "
            "acetaminophen use beyond two weeks because of medication overuse headache. "
            "Amitriptyline is proposed and has not been dispensed.")
    pg.save("K. Mbeki, Clinical Pharmacist")


# ---------------------------------------------------------------- the two scans

def scanned(path: Path, lines: list[str], heading: str, handwritten: bool = False) -> None:
    """Render text onto a page that looks like it came off a scanner.

    Deliberately has no text layer. The skew, the grey cast, the speckles and the edge
    shadow are what a flatbed does to a sheet of paper, and they are here so the pipeline
    has to deal with a page that cannot be read as text.
    """
    import random

    from PIL import Image, ImageDraw, ImageFilter

    rng = random.Random(SEED + len(lines))
    w, h = 1700, 2200                 # about 200 dpi on Letter
    img = Image.new("L", (w, h), 242)
    draw = ImageDraw.Draw(img)

    font = title = None
    for name in ("/System/Library/Fonts/Supplemental/Courier New.ttf",
                 "/System/Library/Fonts/Menlo.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if Path(name).exists():
            from PIL import ImageFont

            font = ImageFont.truetype(name, 34 if handwritten else 30)
            title = ImageFont.truetype(name, 40)
            break

    draw.text((150, 130), facts.BANNER, fill=120, font=font)
    draw.text((150, 210), heading, fill=40, font=title or font)
    draw.line((150, 270, w - 150, 270), fill=120, width=3)

    y = 340
    for row in lines:
        # A scan of a typed page is never perfectly aligned, and a handwritten one
        # wanders more. The jitter is seeded, so it is the same page every run.
        dx = rng.randint(-6, 6) + (rng.randint(-14, 14) if handwritten else 0)
        dy = rng.randint(-3, 3)
        draw.text((150 + dx, y + dy), row, fill=rng.randint(25, 60), font=font)
        y += 62 if handwritten else 48

    # Scanner artefacts: speckle, a soft blur, a vignette at the edges and a slight skew.
    for _ in range(1400):
        x, sy = rng.randint(0, w - 1), rng.randint(0, h - 1)
        draw.point((x, sy), fill=rng.randint(150, 215))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    edge = Image.new("L", (w, h), 255)
    ed = ImageDraw.Draw(edge)
    ed.rectangle((0, 0, 26, h), fill=205)
    ed.rectangle((w - 18, 0, w, h), fill=212)
    ed.rectangle((0, 0, w, 20), fill=208)
    img = Image.composite(img, Image.new("L", (w, h), 190), edge)
    img = img.rotate(-0.7 if handwritten else 0.4, resample=Image.BICUBIC, fillcolor=236)
    img.convert("RGB").save(path, "PNG", optimize=True)


def scanned_referral(path: Path) -> None:
    scanned(path, facts.REFERRAL_TEXT, "REFERRAL LETTER  -  scanned", handwritten=False)


def scanned_diary(path: Path) -> None:
    lines = ["Symptom diary - Maya", ""]
    for day, text in facts.DIARY:
        lines.append(f"Day {day}:  {text}")
    lines += ["", "(given to Dr Farah at the day 9 visit)"]
    scanned(path, lines, "PATIENT SYMPTOM DIARY  -  scanned", handwritten=True)


DOCS = [
    ("01_ed_triage_note.pdf", ed_triage),
    ("02_ed_physician_note.pdf", ed_physician),
    ("03_ct_head_report.pdf", ct_report),
    ("04_mri_brain_report.pdf", mri_report),
    ("05_serum_biomarkers.pdf", lab_report),
    ("06_genotyping_report.pdf", genetics_report),
    ("07_sports_medicine_followup.pdf", followup_note),
    ("08_medication_reconciliation.pdf", medication_list),
    ("09_referral_letter_scan.png", scanned_referral),
    ("10_symptom_diary_scan.png", scanned_diary),
]


def build(out: Path = OUT, quiet: bool = False) -> dict:
    """Write the whole pack and the answer key. Returns what it wrote."""
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for name, fn in DOCS:
        path = out / name
        fn(path)
        written.append({"name": name, "bytes": path.stat().st_size})
        if not quiet:
            print(f"  {name:38s} {path.stat().st_size // 1024:4d} KB")

    key = out / "expected.json"
    key.write_text(json.dumps(facts.expected(), indent=2) + "\n")
    if not quiet:
        print(f"  {'expected.json':38s} {key.stat().st_size // 1024:4d} KB"
              f"   {len(facts.expected()) - 2} fields")
    return {"dir": str(out), "files": written, "expected": str(key)}


def main() -> int:
    """Write the pack and say where it went."""
    print("")
    print(f"  Writing the sample patient pack to {OUT.relative_to(ROOT)}")
    print("")
    got = build()
    print("")
    print(f"  {len(got['files'])} documents. Two of them are scans with no text layer.")
    print("  Her sport is on the scanned referral letter and nowhere else, so without an")
    print("  GEMINI_API_KEY that one field shows as needing review. That is deliberate.")
    print("")
    print("  Next: make seed, then open Add patient and press Use sample patient files.")
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
