"""Pulling the schema out of a document bundle.

Two extractors behind one function. `model()` asks Gemini for the schema, constrains
decoding to it and then validates the reply with pydantic anyway, so a malformed answer is
a retry rather than something that reaches the database. `template()` is a regex pass that
runs when there is no key, when the call fails, and when the model declines: it finds far
fewer fields, and it says so by giving every field it did find a confidence of 0.75 and
leaving the rest at 0.

The fallback is not there to be impressive. It is there so `make sample && make dev` works
on a laptop with no key at all and the screen tells the truth about which extractor ran.
"""

import re

from ..agent import llm
from ..config import cfg
from . import read
from .schema import APOE, BDNF, Extraction, Med, empty

# Bigger than the call-time budget in llm.py: nobody is waiting on a phone here, and a
# ten document bundle is a lot of tokens to read.
TIMEOUT_S = 180.0
# Thinking tokens are spent out of maxOutputTokens, and thinking is left on here, so this
# has to cover the reasoning as well as a schema with twenty-two provenanced fields in it.
# Being generous costs nothing: it is a ceiling, not a reservation.
MAX_TOKENS = 32000
RETRIES = 1

SYSTEM = """You read clinical documents and return structured data. You are not a clinician
and you are not interpreting anything: you are copying out what the documents say.

Rules:
- Only report a value the documents actually state. If a field is absent, return null (or
  an empty list) with confidence 0.
- source_quote must be copied from the document exactly, not paraphrased, and it must be
  the text that contains the value.
- source_file must be one of the file names you were given.
- Never infer a diagnosis, never add a finding, never convert a unit the document did not
  convert, and never clean up a medication dose. Copy the dose string as written.
- If two documents disagree, use the most recent one and quote that one.
- Confidence is about the document, not about how plausible the value is. A value stated
  plainly in a report is high confidence even if it is unusual. A value you worked out
  from context is below 0.6."""


def prompt(docs: list[read.Doc]) -> str:
    """The user turn: the file list, then every readable document."""
    listing = "\n".join(f"- {d.name} ({d.kind}{': ' + d.why if d.why else ''})" for d in docs)
    body = read.corpus(docs)
    images = [d for d in docs if d.kind == "image"]
    tail = ""
    if images:
        tail = ("\n\nThe images attached after this message are the scanned pages "
                + ", ".join(d.name for d in images)
                + ". Read them the same way and name them in source_file.")
    return (
        f"These {len(docs)} files are one patient's records.\n\n{listing}\n\n"
        f"{body}{tail}\n\nReturn the schema."
    )


def parts(docs: list[read.Doc]) -> list[dict]:
    """The user parts: the text prompt, then each scanned page as inline image data."""
    out: list[dict] = [{"text": prompt(docs)}]
    for doc in docs:
        if doc.kind != "image":
            continue
        out.append({"inlineData": {"mimeType": doc.media_type, "data": doc.b64()}})
    return out


# Keywords Gemini accepts in a response schema. Pydantic also emits `title` and `default`
# on every field, which carry no instruction and are dropped: the request is already large
# with ten documents in it, and `default` in particular invites the model to return the
# default instead of reading the document.
KEEP = {
    "type", "description", "enum", "properties", "required", "items", "anyOf",
    "$ref", "$defs", "minimum", "maximum", "nullable",
}


def _prune(node):
    """A JSON Schema with only the keywords Gemini reads, recursively."""
    if isinstance(node, list):
        return [_prune(n) for n in node]
    if not isinstance(node, dict):
        return node
    out = {}
    for key, val in node.items():
        # $defs and properties are maps of name to schema, so their keys are field names
        # and must not be filtered against KEEP.
        if key in ("$defs", "properties"):
            out[key] = {k: _prune(v) for k, v in val.items()}
        elif key in KEEP:
            out[key] = _prune(val)
    return out


def schema() -> dict:
    """The extraction schema as Gemini wants to be given it."""
    return _prune(Extraction.model_json_schema())


def body(docs: list[read.Doc], strict: bool) -> dict:
    """One generateContent request.

    `strict` asks Gemini to constrain decoding to the schema, which is what makes a
    malformed reply impossible rather than unlikely. Some model ids reject a schema this
    nested with a 400, so `model()` can drop back to plain JSON mode with the schema
    written into the prompt instead. Either way the reply is validated by pydantic before
    it goes anywhere, which is the check that actually matters.

    Thinking is left on, unlike the call-time wrapper in llm.py. Reading ten documents and
    working out which one is most recent is reasoning, and nobody is on the phone here.
    """
    ask = parts(docs)
    gen: dict = {"maxOutputTokens": MAX_TOKENS, "temperature": 0.0,
                 "responseMimeType": "application/json"}
    if strict:
        gen["responseJsonSchema"] = schema()
    else:
        import json

        ask = [{"text": "Return JSON matching this schema exactly:\n"
                        + json.dumps(schema())}, *ask]
    return {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": ask}],
        "generationConfig": gen,
    }


def model(docs: list[read.Doc]) -> tuple[Extraction | None, dict]:
    """Ask Gemini for the schema. Returns None and a reason on any failure.

    Pydantic validates the reply, so what reaches the database either fits the schema or
    has been rejected here in favour of the regex pass. A half-parsed record is never
    patched up: see `run` for why.
    """
    import json

    import httpx

    info: dict = {"how": "model", "model": cfg.gemini_model}
    if not llm.live():
        return None, {**info, "how": "none", "why": "no GEMINI_API_KEY, or MOCK_LLM is on"}

    url = f"{llm.API}/{cfg.gemini_model}:generateContent"
    headers = {"x-goog-api-key": cfg.gemini_key}
    why = "the model did not answer"
    # Attempt 1 constrains decoding to the schema. Attempt 2 drops that constraint, which
    # is the retry that matters: a 400 here is nearly always the schema, not the documents.
    for strict in (True, False):
        for _ in range(RETRIES + 1):
            try:
                resp = httpx.post(url, json=body(docs, strict), headers=headers,
                                  timeout=TIMEOUT_S)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                why = f"{type(exc).__name__.lower()} after {TIMEOUT_S:.0f}s"
                continue
            except Exception as exc:
                return None, {**info, "how": "template", "why": str(exc)[:160]}

            got = llm.reply(resp)
            if got.get("error") == "refusal":
                return None, {**info, "how": "template", "why": "the model declined to answer"}
            if got.get("error"):
                why = got["error"]
                break                  # a 400 will not fix itself, go change the request
            if not got.get("text"):
                why = f"HTTP {resp.status_code} from gemini"
                continue

            try:
                return Extraction.model_validate(json.loads(got["text"])), {
                    **info, "model": got.get("model"), "strict": strict,
                    **_usage(resp),
                }
            except Exception as exc:
                why = f"the reply did not fit the schema: {str(exc)[:120]}"

    return None, {**info, "how": "template", "why": why}


def _usage(resp) -> dict:
    """Token counts out of a response, for the build log. Absent is fine."""
    try:
        got = resp.json().get("usageMetadata") or {}
    except Exception:
        return {}
    return {"input_tokens": got.get("promptTokenCount"),
            "output_tokens": got.get("candidatesTokenCount")}


# ---------------------------------------------------------------- the fallback

# Confidence the regex pass gives a field it matched. Not 1.0: a pattern that matched the
# right shape in the wrong sentence is exactly the failure this number is warning about.
HIT = 0.75

PATTERNS: list[tuple[str, str, str]] = [
    # field, regex with one capture group, type: t text, n number
    ("age", r"\bage[:\s]+(\d{1,3})\b", "n"),
    # A label pattern needs its colon. Without it, "Sport and Exercise Medicine" in a
    # department line reads as an occupation of "and Exercise Medicine", and the section
    # heading "MECHANISM OF INJURY" reads as a mechanism of whatever follows it.
    ("occupation", r"\b(?:occupation|sport|employment)\s*:\s*([^\n.;]{3,60})", "t"),
    ("injury_mechanism", r"\bmechanism(?: of injury)?\s*:\s*([^\n.;]{3,120})", "t"),
    ("age", r"\b(\d{1,2})[ -]year[ -]old\b", "n"),
    ("sex", r"\bsex[:\s]+(female|male|f|m)\b", "t"),
    ("gcs", r"\bGCS[^0-9]{0,12}(\d{1,2})\b", "n"),
    ("loc_seconds", r"loss of consciousness[^0-9a-z]{0,20}(\d{1,4})\s*(?:s|sec|seconds)", "n"),
    ("gfap_pg_ml", r"\bGFAP[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)", "n"),
    ("uch_l1_pg_ml", r"\bUCH-?L1[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)", "n"),
    ("nfl_pg_ml", r"\b(?:NfL|neurofilament light)[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)", "n"),
    ("swi_foci", r"\b(\d{1,2})\s+(?:small\s+)?(?:foci|microh[ae]morrhages?)", "n"),
    ("injury_date", r"\b(?:date of injury|injury date)[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})", "t"),
    ("name", r"\b(?:patient name|name)[:\s]+([A-Z][a-z]+(?: [A-Z][a-z]+){1,2})\b", "t"),
]

SEX = {"f": "female", "female": "female", "m": "male", "male": "male"}

# Words that mean the next thing is a label or a heading, not a value.
LABELS = ("date of", "mrn", "patient name", "document date", "sex", "date of birth")


def value_like(raw: str) -> bool:
    """False when a capture is really a heading or the next field's label.

    Worth spelling out because the obvious guard does not work: these patterns run with
    re.I, and under re.I a `[a-z]` character class matches upper case too, so requiring a
    lower case first letter silently requires nothing at all.
    """
    got = str(raw).strip()
    if len(got) < 3:
        return False
    if got.isupper():                      # a section heading
        return False
    if got.rstrip().endswith(":"):         # the next field's label
        return False
    return not any(got.lower().startswith(p) for p in LABELS)
SYMPTOM_WORDS = ["headache", "pressure", "nausea", "dizziness", "photophobia",
                 "light sensitivity", "neck pain", "fatigue", "blurred vision", "vomiting",
                 "insomnia", "irritability", "memory", "concentration", "balance",
                 "tinnitus"]
# "pressure" on its own is also half of "blood pressure", which is a vital sign and not a
# symptom. Each of these needs the preceding word checked, not just the word itself.
SYMPTOM_NOT = {"pressure": ("blood", "intracranial", "perfusion")}
NEGATION = ("no ", "not ", "without ", "denies ", "denied ", "negative for ", "free of ",
            "absent ", "nil ")


def mentions(text: str, low: str, word: str) -> int:
    """Offset of a real mention of a symptom, or -1.

    Skips a mention that is negated ("nausea without vomiting") and one that is part of a
    different phrase ("blood pressure"). A regex pass cannot do this properly, but these
    two cases are most of it in a head injury chart, and both of them put something on the
    screen that the chart explicitly says is not there.
    """
    at = 0
    bad = SYMPTOM_NOT.get(word, ())
    while True:
        at = low.find(word, at)
        if at == -1:
            return -1
        before = low[max(0, at - 24): at]
        if any(before.rstrip().endswith(b) for b in bad):
            at += len(word)
            continue
        if any(n in before[-14:] for n in NEGATION):
            at += len(word)
            continue
        return at
MED_WORDS = ["sertraline", "amitriptyline", "methylphenidate", "amantadine", "propranolol",
             "levetiracetam", "ondansetron", "gabapentin", "melatonin", "acetaminophen",
             "paracetamol", "ibuprofen", "naproxen", "topiramate", "nortriptyline"]
PROPOSED = ("propose", "consider", "not yet started", "to start", "recommend",
            "trial of", "plan to")
STOPPED = ("stopped", "discontinued", "ceased", "held")


def line_of(text: str, at: int, to: int | None = None) -> str:
    """The text from the start of one line to the end of another, copied exactly.

    A quote has to contain the value it is a quote for. In a real clinical PDF the label
    and the value land on separate lines of the text layer, because they are drawn at
    different x positions: "GCS:" then "15 (E4 V5 M6)". Quoting only the line the pattern
    started on gives "GCS:" and no number, which is a provenance trail that proves
    nothing. Spanning the whole match fixes that and stays a verbatim copy.
    """
    start = text.rfind("\n", 0, at) + 1
    tail = to if to is not None and to > at else at
    end = text.find("\n", tail)
    return text[start: end if end != -1 else len(text)].strip()[:300]


SENTENCE_END = re.compile(r"[.;]\s|\n\s*\n")
HEADING = re.compile(r"^[A-Z][A-Z0-9 ,/()-]{3,}$", re.M)


def headings(text: str) -> list[tuple[int, str]]:
    """Section headings as (offset, the heading), in order.

    A clinical form is organised by heading, not by sentence. "CURRENT MEDICATION" and
    "PROPOSED, NOT YET STARTED" are what say whether a drug is being taken, and they are
    the only thing on the page that does.
    """
    return [(m.start(), m.group(0).strip()) for m in HEADING.finditer(text)]


def section_at(marks: list[tuple[int, str]], at: int) -> str:
    """The heading in force at an offset, or an empty string."""
    got = ""
    for off, head in marks:
        if off > at:
            break
        got = head
    return got


def status_of(text: str) -> str:
    """current, proposed or stopped from a piece of text, or an empty string."""
    low = text.lower()
    if any(p in low for p in PROPOSED):
        return "proposed"
    if any(p in low for p in STOPPED):
        return "stopped"
    if "current" in low or "taking" in low or "continue" in low:
        return "current"
    return ""


def sentences(text: str) -> list[tuple[int, str]]:
    """Sentences as (offset in the original text, the sentence).

    A clinical note wraps, so a line is not a sentence: "Taking ondansetron 4 mg PRN and\n
    acetaminophen 500 mg. Plan: consider amitriptyline 10 mg at night." is two lines and
    two sentences, and reading doses off lines gives amitriptyline the acetaminophen dose.
    The offsets are into the original text so a quote is still copied exactly, newline and
    all, rather than reflowed.
    """
    # A heading is a boundary as much as a full stop is. A medication reconciliation
    # sheet has almost no full stops, so without this the whole page is one "sentence"
    # containing the words CURRENT, PROPOSED and STOPPED at once, and every drug on it
    # comes out with whichever of those is checked first.
    cuts = {0, len(text)}
    for hit in SENTENCE_END.finditer(text):
        cuts.add(hit.start() + 1)
        cuts.add(hit.end())
    for hit in HEADING.finditer(text):
        cuts.add(hit.start())
        cuts.add(hit.end())

    out = []
    marks = sorted(cuts)
    for start, end in zip(marks, marks[1:]):
        raw = text[start:end]
        chunk = raw.strip()
        if chunk:
            out.append((start + (len(raw) - len(raw.lstrip())), chunk))
    return out


# Where a conclusion stops. Each of these is a real boundary in a clinical report: a
# blank line, a new section heading, the page footer, or a labelled aside like "Note:".
ASIDE = re.compile(r"(?:^|\n)\s*(?:note|comment|caveat|limitations?|disclaimer)\b\s*[:.]",
                   re.I)
FOOTER = re.compile(r"SYNTHETIC RECORD|Reported by|Authorised by|MRN\s+\S+\s+\|")
MAX_SENTENCES = 3


def paragraph_end(body: str) -> int:
    """How far a conclusion runs. The earliest real boundary, or three sentences."""
    stops = [len(body)]
    blank = re.search(r"\n\s*\n", body)
    if blank:
        stops.append(blank.start())
    head = HEADING.search(body)
    if head and head.start() > 0:
        stops.append(head.start())
    for pattern in (ASIDE, FOOTER):
        hit = pattern.search(body)
        if hit and hit.start() > 0:
            stops.append(hit.start())
    ends = [m.end() for m in re.finditer(r"[.!?](?:\s|$)", body)]
    if len(ends) >= MAX_SENTENCES:
        stops.append(ends[MAX_SENTENCES - 1])
    return max(10, min(stops))


def is_report(text: str, modality: str) -> bool:
    """True when this document is a report of this modality, not one that mentions it.

    Every note in a head injury chart says "CT" somewhere. Only one of them is the CT
    report. The difference is a title line or an examination field that names the
    modality, so that is what is required here.
    """
    title = rf"(?:^|\n)[^\n]{{0,60}}\b{modality}\b[^\n]{{0,60}}\breport\b"
    exam = rf"\bexamination[:\s]+[^\n]{{0,40}}\b{modality}\b"
    return bool(re.search(title, text, re.I) or re.search(exam, text, re.I))


def impression_of(text: str, modality: str) -> tuple[str, int, int] | None:
    """The conclusion line of a report, not its heading.

    A report says "CT HEAD REPORT" and then "Impression: no acute haemorrhage", and it is
    the second line that is the finding. Searching for the modality alone matches the
    heading every time, which looks like a successful read and carries no information.
    """
    if not is_report(text, modality):
        return None
    head = re.search(rf"\b{modality}\b", text, re.I)
    if head is None:
        return None
    window = text[head.start(): head.start() + 1400]
    for word in ("impression", "conclusion", "findings?"):
        hit = re.search(rf"\b{word}\b[:\s]+", window, re.I)
        if hit is None:
            continue
        body = window[hit.end():]
        stop = paragraph_end(body)
        text = " ".join(body[:stop].split())[:280]
        if len(text) >= 10:
            return text, head.start() + hit.end(), head.start() + hit.end() + min(stop, 280)
    # No labelled impression. Take the first sentence after the heading that is prose.
    for off, sent in sentences(window):
        if len(sent) > 30 and not sent.isupper():
            return sent[:280], head.start() + off, head.start() + off + len(sent)
    return None


def template(docs: list[read.Doc]) -> tuple[Extraction, dict]:
    """A regex pass over the readable text. Finds less, and says which fields it found."""
    readable = [d for d in docs if d.kind == "text"]
    unread = [d.name for d in docs if d.kind != "text"]
    if not readable:
        why = "no file in this bundle had any readable text"
        if unread:
            why += f" ({len(unread)} could not be read: {', '.join(unread[:4])})"
        return empty(why), {"how": "template", "fields": 0, "unread": unread}

    data: dict = {}
    for key, info in Extraction.model_fields.items():
        ann = info.annotation
        data[key] = {"confidence": 0.0, "source_file": "", "source_quote": "",
                     "value": [] if ann in (type(None),) else None}
        if key in ("medications", "symptoms"):
            data[key]["value"] = []

    def put(key: str, value, doc: read.Doc, quote: str) -> None:
        if data[key]["confidence"] >= HIT:
            return                      # first document wins, and they are in order
        data[key] = {"value": value, "confidence": HIT, "source_file": doc.name,
                     "source_quote": quote}

    for doc in readable:
        low = doc.text.lower()
        for key, pattern, typ in PATTERNS:
            for hit in re.finditer(pattern, doc.text, re.I):
                raw = hit.group(1)
                quote = line_of(doc.text, hit.start(), hit.end())
                if typ == "n":
                    try:
                        put(key, float(raw), doc, quote)
                    except ValueError:
                        continue
                    break
                if key != "sex" and not value_like(raw):
                    continue
                val = SEX.get(raw.lower(), raw) if key == "sex" else raw.strip()
                put(key, val, doc, quote)
                break

        for allele in APOE:
            hit = re.search(re.escape(allele).replace("/", r"\s*/\s*"), doc.text, re.I)
            if hit:
                put("apoe", allele, doc, line_of(doc.text, hit.start(), hit.end()))
                break
        for geno in BDNF:
            hit = re.search(re.escape(geno).replace("/", r"\s*/\s*"), doc.text, re.I)
            if hit:
                put("bdnf", geno, doc, line_of(doc.text, hit.start(), hit.end()))
                break

        for side in ("right", "left"):
            hit = re.search(rf"\b{side}\b[^.\n]{{0,40}}\b(frontal|temporal|parietal|occipital)\b",
                            doc.text, re.I)
            if hit:
                put("contusion_side", side, doc, line_of(doc.text, hit.start(), hit.end()))
                put("contusion_lobe", hit.group(1).lower(), doc,
                    line_of(doc.text, hit.start(), hit.end()))
                break

        for key, word in (("ct_finding", "ct"), ("mri_finding", "mri")):
            got = impression_of(doc.text, word)
            if got is not None:
                text, at, to = got
                put(key, text, doc, line_of(doc.text, at, to))

        at_of = {w: mentions(doc.text, low, w) for w in SYMPTOM_WORDS}
        found = [w for w in SYMPTOM_WORDS if at_of[w] >= 0]
        if found:
            have = list(data["symptoms"]["value"])
            fresh = [w for w in found if w not in have]
            if fresh:
                data["symptoms"] = {
                    "value": have + fresh, "confidence": HIT,
                    # The document that contributed the most names is the one cited, which
                    # is normally the symptom score sheet rather than a passing mention.
                    "source_file": doc.name if len(fresh) >= len(have) else data["symptoms"]["source_file"],
                    "source_quote": (line_of(doc.text, at_of[fresh[0]])
                                     if len(fresh) >= len(have) else data["symptoms"]["source_quote"]),
                }

        meds, med_at = [], -1
        marks = headings(doc.text)
        for off, sent in sentences(doc.text):
            slow = sent.lower()
            hits = sorted(((slow.find(w), w) for w in MED_WORDS if w in slow))
            if not hits:
                continue
            status = status_of(sent) or status_of(section_at(marks, off)) or "current"
            for i, (start, word) in enumerate(hits):
                # The dose belongs to this drug only if it appears before the next one is
                # named. Otherwise "ondansetron 4 mg and acetaminophen 500 mg" gives both
                # of them 4 mg, or worse, gives the second one the first one's.
                stop = hits[i + 1][0] if i + 1 < len(hits) else len(sent)
                window = sent[start + len(word): stop]
                dhit = re.search(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b", window, re.I)
                if any(m["name"] == word for m in meds):
                    continue
                meds.append(Med(name=word, dose=dhit.group(0).strip() if dhit else "",
                                status=status).model_dump())
                if med_at < 0:
                    med_at = off
        if meds:
            have = list(data["medications"]["value"])
            names = {m["name"] for m in have}
            fresh = [m for m in meds if m["name"] not in names]
            # A later document updates the status of a drug the earlier one already named:
            # the reconciliation sheet is where "proposed" and "stopped" are stated, and it
            # comes after the note that first mentioned the drug.
            for m in have:
                later = next((n for n in meds if n["name"] == m["name"]), None)
                if later and later["status"] != "unknown":
                    m["status"] = later["status"]
                    if later["dose"]:
                        m["dose"] = later["dose"]
            if fresh or not have:
                data["medications"] = {
                    "value": have + fresh, "confidence": HIT,
                    "source_file": doc.name if len(fresh) >= len(have) else data["medications"]["source_file"],
                    "source_quote": (line_of(doc.text, max(med_at, 0))
                                     if len(fresh) >= len(have) else data["medications"]["source_quote"]),
                }
            else:
                data["medications"]["value"] = have

    # The gap between the injury and the latest note in the bundle. Derived, not quoted,
    # so it is given the same confidence as the two dates it came from and the quote names
    # both of them rather than pretending a sentence said it.
    latest = as_of(readable)
    stated = data["injury_date"].get("value")
    if latest and stated:
        try:
            import datetime as _dt

            gap = (_dt.date.fromisoformat(latest) - _dt.date.fromisoformat(str(stated)[:10])).days
        except ValueError:
            gap = None
        if gap is not None and gap >= 0:
            data["injury_days_ago"] = {
                "value": float(gap), "confidence": HIT,
                "source_file": data["injury_date"]["source_file"],
                "source_quote": f"injury {stated}, most recent document dated {latest}",
                # No document states this. It is the gap between two dates that are
                # stated, and saying so is better than quoting a sentence that does not
                # exist.
                "derived_from": ["injury_date"],
            }

    got = Extraction.model_validate(data)
    return got, {"how": "template", "fields": len(got.filled()), "unread": unread,
                 "as_of": latest}


ISO_DATE = re.compile(r"\b(20[0-9]{2})-([01][0-9])-([0-3][0-9])\b")


def as_of(docs: list[read.Doc]) -> str:
    """The most recent date mentioned anywhere in the bundle.

    A document bundle has its own present tense. "Nine days since the injury" has to be
    measured from the latest note in the file, not from whatever today happens to be,
    otherwise the same records describe a patient who gets further from their injury every
    day the demo is run.
    """
    best = ""
    for doc in docs:
        if doc.kind != "text":
            continue
        for hit in ISO_DATE.finditer(doc.text):
            got = hit.group(0)
            if got > best:
                best = got
    return best


def run(docs: list[read.Doc]) -> tuple[Extraction, dict]:
    """Extract with the model, falling back to the regex pass. Always returns a schema.

    When the model succeeds, nothing from the fallback is mixed in. Half a record from one
    extractor and half from another would make `source_file` mean two different things on
    the same screen, and there would be no way to tell which fields to trust.
    """
    got, info = model(docs)
    if got is not None:
        info["fields"] = len(got.filled())
        info["needs_review"] = got.needs_review()
        return got, info

    fallback, finfo = template(docs)
    finfo["why"] = info.get("why", "")
    finfo["needs_review"] = fallback.needs_review()
    return fallback, finfo
