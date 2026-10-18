"""Prepare the supplied v6 layers; preserve their proportions and original files."""
from pathlib import Path
import json
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "Synapshot_Paper_Landing_Kit_v6" / "assets"
OUT = ROOT / "web" / "public" / "scene" / "v6"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Selected by inspecting every supplied image, not the old manifest.
    room = PACK / "wide outpaint og ref.png"
    source = Image.open(room).convert("RGB")
    assert source.size == (1122, 1402)
    # Copy only unobstructed floor, alternating its vertical direction so the edge pixels
    # match at each join. All original architecture, furniture and silhouette stay intact.
    floor = source.crop((0, 1202, 1122, 1402))
    extended = Image.new("RGB", (1122, 1802))
    extended.paste(source, (0, 0))
    extended.paste(ImageOps.flip(floor), (0, 1402))
    extended.paste(floor, (0, 1602))
    assert extended.crop((0, 0, 1122, 1402)).tobytes() == source.tobytes()
    extended.save(OUT / "room-og-extended.webp", quality=94, method=6)
    Image.open(PACK / "curtain_overlay.png").save(OUT / "curtain.webp", quality=88, method=6)
    # Remove the separate bowl from the supplied plant sheet. The room already has one.
    Image.open(PACK / "plant_overlay.png").crop((490, 0, 941, 1420)).save(
        OUT / "plant.webp", quality=90, method=6)
    leaves = Image.open(PACK / "drifting_leaves_overlay.png")
    boxes = [(690, 55, 885, 280), (0, 500, 345, 825), (90, 1060, 325, 1320)]
    for i, box in enumerate(boxes):
        leaf = leaves.crop(box)
        bounds = leaf.getchannel("A").getbbox()
        if bounds:
            leaf = leaf.crop(bounds)
        leaf.thumbnail((128, 128), Image.Resampling.LANCZOS)
        leaf.save(OUT / f"leaf-{i + 1}.webp", quality=88, method=6)
    (OUT / "manifest.json").write_text(json.dumps({
        "source": str(room.relative_to(ROOT)).replace("\\", "/"),
        "coordinates": [1122, 1802],
        "original_bounds": [0, 0, 1122, 1402],
        "floor_patch": [0, 1202, 1122, 1402],
        "floor_extension": "400 native pixels; alternating reflected/normal copies; CSS fade at bottom only",
        "curtain": {"x": 0, "y": 0, "scale": 0.5},
        "plant": {"x": 997, "y": 170, "scale": 0.36, "crop": [490, 0, 941, 1420]},
        "brain": {"x": 773, "y": 365, "width": 133, "height": 133},
        "light": "Localized fabric transmission; supplied light artwork used as reference only."
    }, indent=2) + "\n")
    for p in OUT.iterdir():
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
