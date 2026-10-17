"""Read four SNPs out of a VCF and throw the rest away.

Only rs429358, rs7412, rs6265 and rs4680 are read. Nothing else is parsed, kept or
returned, and in live mode the uploaded file is deleted as soon as those four are out.
"""

import gzip
from pathlib import Path

WANT = ["rs429358", "rs7412", "rs6265", "rs4680"]


def open_text(path: str | Path):
    """Open a plain or gzipped VCF as text."""
    path = Path(path)
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt")
    return open(path, "r")


def alleles(ref: str, alt: str, gt: str) -> list[str]:
    """Allele letters for a genotype field like 0/1, 1|1 or ./."""
    codes = alt.split(",")
    out = []
    for part in gt.replace("|", "/").split("/")[:2]:
        if part == "0":
            out.append(ref.upper())
        elif part.isdigit() and 1 <= int(part) <= len(codes):
            out.append(codes[int(part) - 1].upper())
    return out


def read_snps(path: str | Path) -> dict:
    """Allele pairs for the four SNPs, keyed by rsid, missing ones absent."""
    got = {}
    with open_text(path) as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            col = line.rstrip("\n").split("\t")
            if len(col) < 10:
                continue
            rsid = col[2]
            if rsid not in WANT:
                continue
            gt = col[9].split(":")[0]
            got[rsid] = alleles(col[3], col[4], gt)
            if len(got) == len(WANT):
                break
    return got


def call_apoe(snps: dict) -> int:
    """APOE e4 allele count from rs429358 and rs7412.

    e4 haplotype is rs429358 C with rs7412 C, e2 is rs429358 T with rs7412 T.
    Genotypes here are unphased, so the count is the number of C alleles at rs429358
    minus any that have to belong to an e2 or e1 haplotype. Phase matters in the rare
    e1 case and this returns the common reading.
    """
    a1 = snps.get("rs429358", [])
    a2 = snps.get("rs7412", [])
    if not a1:
        return 0
    c429 = sum(1 for b in a1 if b == "C")
    t7412 = sum(1 for b in a2 if b == "T")
    return int(max(0, min(2, c429 - max(0, c429 + t7412 - 2))))


def call_bdnf(snps: dict) -> bool:
    """BDNF Val66Met carrier. rs6265 A is the Met allele."""
    return any(b == "A" for b in snps.get("rs6265", []))


def call_comt(snps: dict) -> str:
    """COMT Val158Met. rs4680 G is Val, A is Met."""
    a = snps.get("rs4680", [])
    met = sum(1 for b in a if b == "A")
    if len(a) < 2:
        return "Val/Val"
    return ["Val/Val", "Val/Met", "Met/Met"][met]


def parse(path: str | Path, discard: bool = False) -> dict:
    """The three calls plus which SNPs were found. Deletes the file when discard is set."""
    snps = read_snps(path)
    out = {
        "apoe_e4": call_apoe(snps),
        "bdnf_met": call_bdnf(snps),
        "comt": call_comt(snps),
        "found": [r for r in WANT if r in snps],
        "missing": [r for r in WANT if r not in snps],
    }
    if discard:
        try:
            Path(path).unlink()
            out["raw_kept"] = False
        except OSError:
            out["raw_kept"] = True
    else:
        out["raw_kept"] = True
    return out


def write_vcf(path: str | Path, apoe_e4: int, bdnf_met: bool, comt: str, sample: str = "synthetic") -> Path:
    """Write a minimal valid VCF carrying exactly the four SNPs, for synthetic patients."""
    # rs429358 C is e4 defining, rs7412 T is e2 defining, so e4 count sets the C count.
    g429 = {0: "0/0", 1: "0/1", 2: "1/1"}[int(apoe_e4)]
    g6265 = "0/1" if bdnf_met else "0/0"
    g4680 = {"Val/Val": "0/0", "Val/Met": "0/1", "Met/Met": "1/1"}.get(comt, "0/0")
    rows = [
        ("19", "44908684", "rs429358", "T", "C", g429),
        ("19", "44908822", "rs7412", "C", "T", "0/0"),
        ("11", "27658369", "rs6265", "G", "A", g6265),
        ("22", "19963748", "rs4680", "G", "A", g4680),
    ]
    head = [
        "##fileformat=VCFv4.2",
        "##source=UNNAMED_synthetic",
        '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t" + sample,
    ]
    body = ["\t".join([c, p, r, ref, alt, ".", "PASS", ".", "GT", gt]) for c, p, r, ref, alt, gt in rows]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(head + body) + "\n")
    return path
