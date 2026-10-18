"""Getting something readable out of each uploaded file.

Three outcomes per file, and the difference matters:

- text, which the model and the fallback extractor can both read
- an image, which only the model can read, because there is no OCR here
- nothing, with a reason

The third case is the one worth being careful about. A scanned page that could not be read
must not quietly become an empty record: `kind` says "image" and `text` is empty, and if
there is no model key the fields that only that page could have supplied stay at
confidence 0 and show as needing review. That is the honest answer, and it is also what
happens in a real clinic when a fax arrives sideways.
"""

import base64
from dataclasses import dataclass, field
from pathlib import Path

# Hard ceiling per file. A clinical PDF is tens of kilobytes of text; anything far past
# this is either not a document or not one worth sending to a model by the page.
MAX_BYTES = 12 * 1024 * 1024
MAX_CHARS = 40_000

TEXT_SUFFIX = {".txt", ".md", ".csv", ".tsv", ".json", ".vcf", ".log"}
IMAGE_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp", ".gif": "image/gif"}


@dataclass
class Doc:
    """One file, after we have tried to read it."""

    name: str
    kind: str                      # "text", "image" or "none"
    text: str = ""
    media_type: str = ""
    data: bytes = field(default=b"", repr=False)
    pages: int = 0
    why: str = ""                  # why nothing could be read, when kind is "none"

    def b64(self) -> str:
        """The image bytes, base64, for an image content block."""
        return base64.standard_b64encode(self.data).decode()

    def summary(self) -> dict:
        """What the build log shows for this file."""
        out = {"name": self.name, "kind": self.kind}
        if self.kind == "text":
            out["chars"] = len(self.text)
            if self.pages:
                out["pages"] = self.pages
        if self.kind == "image":
            out["bytes"] = len(self.data)
        if self.why:
            out["why"] = self.why
        return out


def pdf_text(data: bytes) -> tuple[str, int, str]:
    """Text and page count out of a PDF, or an empty string and the reason."""
    try:
        import pypdf
    except Exception:
        return "", 0, "pypdf is not installed, so this PDF could not be read"

    import io

    try:
        doc = pypdf.PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in doc.pages]
    except Exception as exc:
        return "", 0, f"this PDF could not be parsed: {str(exc)[:90]}"

    text = "\n".join(pages).strip()
    if not text:
        # A scan saved as a PDF. There is no OCR here, so say so rather than return "".
        return "", len(pages), "this PDF has no text layer, it looks like a scan"
    return text, len(pages), ""


def one(name: str, data: bytes) -> Doc:
    """Read one file by name and bytes."""
    suffix = Path(name).suffix.lower()
    if len(data) > MAX_BYTES:
        return Doc(name=name, kind="none",
                   why=f"{len(data) // (1024 * 1024)} MB is over the {MAX_BYTES // (1024 * 1024)} MB limit")

    if suffix == ".pdf":
        text, pages, why = pdf_text(data)
        if text:
            return Doc(name=name, kind="text", text=text[:MAX_CHARS], pages=pages)
        return Doc(name=name, kind="none", pages=pages, why=why)

    if suffix in IMAGE_SUFFIX:
        return Doc(name=name, kind="image", media_type=MEDIA.get(suffix, "image/png"), data=data)

    if suffix in TEXT_SUFFIX or not suffix:
        try:
            text = data.decode("utf-8", errors="replace").strip()
        except Exception as exc:
            return Doc(name=name, kind="none", why=str(exc)[:90])
        if not text:
            return Doc(name=name, kind="none", why="the file is empty")
        return Doc(name=name, kind="text", text=text[:MAX_CHARS])

    # A NIfTI, a DICOM, an archive. Not something to read words out of, and the imaging
    # loaders handle those separately, so this is not an error.
    return Doc(name=name, kind="none", why=f"{suffix or 'this file type'} is not a text document")


def many(files: list[tuple[str, bytes]]) -> list[Doc]:
    """Read a whole bundle, in the order it was given."""
    return [one(name, data) for name, data in files]


def from_dir(path: Path) -> list[tuple[str, bytes]]:
    """Every file in a directory as (name, bytes), sorted, for the sample bundle."""
    out = []
    for item in sorted(Path(path).iterdir()):
        if item.is_file() and not item.name.startswith("."):
            out.append((item.name, item.read_bytes()))
    return out


def corpus(docs: list[Doc], limit: int = MAX_CHARS) -> str:
    """Every readable document as one labelled block, for the extractor prompt.

    The file name goes above each one because the schema asks for `source_file`, and the
    model cannot name a file it was never told the name of.
    """
    parts = []
    used = 0
    for doc in docs:
        if doc.kind != "text":
            continue
        head = f"=== FILE: {doc.name} ===\n"
        body = doc.text[: max(0, limit - used - len(head))]
        if not body:
            break
        parts.append(head + body)
        used += len(head) + len(body)
    return "\n\n".join(parts)
