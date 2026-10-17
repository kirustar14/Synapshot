"""The genotype parser, the upload validator and the BIDS writer."""

import json
from pathlib import Path

from backend.data import genotype as gt
from backend.data import synthetic as syn
from backend.data import upload


def test_genotype_reads_the_four_snps(tmp_path):
    """The parser finds exactly the four SNPs in a synthetic VCF and nothing else."""
    pat = syn.make_patient(3)
    files = syn.write_bids(pat, root=tmp_path)
    got = gt.parse(files["vcf"])
    assert got["found"] == gt.WANT
    assert got["missing"] == []
    assert got["apoe_e4"] == pat["alleles"]["apoe_e4"]
    assert got["bdnf_met"] == pat["alleles"]["bdnf_met"]
    assert got["comt"] == pat["alleles"]["comt"]


def test_genotype_roundtrips_every_combination(tmp_path):
    """Every genotype we can write is read back the same."""
    path = tmp_path / "g.vcf"
    for e4 in (0, 1, 2):
        for met in (False, True):
            for comt in ("Val/Val", "Val/Met", "Met/Met"):
                gt.write_vcf(path, e4, met, comt)
                got = gt.parse(path)
                assert (got["apoe_e4"], got["bdnf_met"], got["comt"]) == (e4, met, comt)


def test_genotype_ignores_everything_else(tmp_path):
    """Other variants in the file are not parsed, kept or returned."""
    path = tmp_path / "extra.vcf"
    gt.write_vcf(path, 1, True, "Val/Met")
    body = path.read_text().rstrip("\n")
    body += "\n1\t12345\trs9999999\tA\tG\t.\tPASS\t.\tGT\t1/1\n"
    path.write_text(body)
    snps = gt.read_snps(path)
    assert set(snps) == set(gt.WANT), "a fifth variant leaked into the parse"


def test_genotype_discard_deletes_the_raw_file(tmp_path):
    """Live mode does not keep the genome after the three calls are out."""
    path = tmp_path / "live.vcf"
    gt.write_vcf(path, 2, False, "Met/Met")
    got = gt.parse(path, discard=True)
    assert got["apoe_e4"] == 2
    assert got["raw_kept"] is False
    assert not path.exists()


def test_bids_folder_has_every_modality(tmp_path):
    """The synthetic patient writes a complete, readable input set."""
    pat = syn.make_patient(5)
    files = syn.write_bids(pat, root=tmp_path)
    for key in ("t1", "dwi", "fmri", "vcf", "labs", "injury", "bval", "bvec"):
        assert Path(files[key]).exists(), f"{key} was not written"
    assert json.loads(Path(files["injury"]).read_text())["synthetic"] is True
    assert "unit" in Path(files["labs"]).read_text().splitlines()[0]


def test_upload_validation_accepts_the_synthetic_set(tmp_path):
    """Every file the generator writes passes its own modality check."""
    pat = syn.make_patient(7)
    rows = upload.synthetic_set(syn.write_bids(pat, root=tmp_path))
    assert [r["kind"] for r in rows] == upload.KINDS
    for row in rows:
        assert row["status"] == "ok", f"{row['kind']} came back {row['status']}: {row['note']}"
        assert row["sets"], "every input must say what it changes"
        assert row["synthetic"] is True


def test_upload_validation_catches_broken_files(tmp_path):
    """A bad bval, a missing unit column and a short VCF are all caught."""
    pat = syn.make_patient(9)
    files = syn.write_bids(pat, root=tmp_path)

    Path(files["bval"]).write_text("0 1000 1000\n")
    status, note = upload.validate("dwi", Path(files["dwi"]), {"bval": files["bval"], "bvec": files["bvec"]})
    assert status == "error" and "bval" in note

    labs = Path(files["labs"])
    labs.write_text("marker,value\nGFAP,120\n")
    status, note = upload.validate("labs", labs)
    assert status == "error" and "unit" in note

    vcf = Path(files["vcf"])
    vcf.write_text("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ts\n")
    status, note = upload.validate("vcf", vcf)
    assert status == "warn" and "0 of 4" in note

    status, note = upload.validate("t1", Path(tmp_path / "nope.nii.gz"))
    assert status == "missing"


def test_template_set_is_all_missing():
    """A patient with no imaging gets a complete list of missing inputs."""
    rows = upload.template_set()
    assert [r["kind"] for r in rows] == upload.KINDS
    assert all(r["status"] == "missing" for r in rows)
    assert all("template" in r["note"] for r in rows)


def test_mean_damage_is_sc_weighted():
    """Edges with no tract between them do not dilute the mean damage."""
    import numpy as np

    from backend.data.templates import templates
    from backend.twin import dmf

    w = dmf.upper(templates()["sc"])
    dmg = np.zeros_like(w)
    dmg[w > 0] = 0.5
    assert abs(syn.mean_damage(dmg) - 0.5) < 1e-9, "damage on every real tract should read 0.5"
