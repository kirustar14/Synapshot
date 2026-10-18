"""Turn the landing reference photo into a clean background plate.

    python scripts/landing_clean_plate.py

The reference has the wordmark, headline, body copy and Login button baked into the
photograph. They cannot stay there: the page draws those as real HTML, and a screenshot
with text in it would double up. This lifts them out and reconstructs the wall behind them
by diffusion from the surrounding pixels, so the result is one continuous photograph with
no rectangular seams.

The source is a stock-style image, not a patient record. Output lands in web/public/landing/.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Calm Insight for Recovering Minds.png"
OUT = ROOT / "web" / "public" / "landing" / "hero-clean.jpg"

# Regions that hold baked-in UI, measured off the reference at 1536 x 1024.
# (x0, x1, y0, y1) — the ink inside each is masked, not the whole box.
TEXT_BOXES = [
    (70, 340, 70, 135),      # wordmark
    (75, 700, 315, 590),     # headline, three lines
    (75, 775, 615, 710),     # supporting copy
]
BUTTON_BOX = (1300, 1470, 38, 130)  # the pill plus a margin for its edge

# The head-and-brain artwork is drawn in the photograph. The brain is replaced by
# assets/brain-trace.svg so it can animate, and the drawn one has to go first or the two
# outlines sit on top of each other. The silhouette shadow stays: it is a soft gradient,
# not a thin bright stroke, so the stroke filter below leaves it alone.
BRAIN_BOX = (900, 1220, 288, 582)


def _ink_mask(img: Image.Image) -> np.ndarray:
    """Dark pixels inside the text regions, plus the whole button rectangle."""
    a = np.asarray(img).astype(np.float32)
    lum = a.mean(axis=2)
    mask = np.zeros(lum.shape, dtype=bool)
    for x0, x1, y0, y1 in TEXT_BOXES:
        mask[y0:y1, x0:x1] = lum[y0:y1, x0:x1] < 190.0
    x0, x1, y0, y1 = BUTTON_BOX
    mask[y0:y1, x0:x1] = True
    return mask


def _brain_mask(img: Image.Image, box: tuple[int, int, int, int] = BRAIN_BOX) -> np.ndarray:
    """Thin bright strokes only, inside the brain's box.

    A high pass against a 6px blur, rather than a threshold on brightness: the wall behind
    the brain is already brighter than the strokes' average, so only local contrast finds
    them. The head shadow's edge is a wide gradient and does not survive this filter.
    """
    lum = np.asarray(img.convert("L")).astype(np.float32)
    bg = np.asarray(img.convert("L").filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    x0, x1, y0, y1 = box
    mask = np.zeros(lum.shape, dtype=bool)
    mask[y0:y1, x0:x1] = (lum - bg)[y0:y1, x0:x1] > 8.0
    return mask


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Square dilation. One MaxFilter pass: growing the mask as we iterate would balloon it."""
    size = 2 * radius + 1
    grown = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))
    return np.asarray(grown) > 127


def _diffuse_fill(img: Image.Image, mask: np.ndarray, scale: int = 4, rounds: int = 900) -> Image.Image:
    """`scale` is the grid the solve runs on: coarser is faster, finer hugs the local shadow.  # noqa: D401"""
    """Fill the masked area from its surroundings, solved on a coarse grid then upsampled.

    The wall is a smooth gradient, so a low-frequency solution is the right one: it cannot
    invent texture that is not there, which is exactly what keeps the repair invisible.
    """
    w, h = img.size
    small = img.resize((w // scale, h // scale), Image.BOX)
    grid = np.asarray(small).astype(np.float32).copy()
    # Grow the hole by about four cells of the coarse grid, so cells that average part of a
    # stroke out are excluded from the boundary conditions rather than poisoning them.
    hole = np.asarray(
        Image.fromarray((_dilate(mask, max(2, 4 * scale)) * 255).astype(np.uint8)).resize(
            (w // scale, h // scale), Image.BILINEAR
        )
    ) > 24
    grid[hole] = np.nan

    # Cells partly covered by ink keep a darkened average, so they are excluded too, and the
    # solve below is a plain neighbour mean with an explicit count instead of nanmean.
    for _ in range(rounds):
        empty = np.isnan(grid)
        if not empty.any():
            break
        pad = np.pad(grid, ((1, 1), (1, 1), (0, 0)), constant_values=np.nan)
        stack = np.stack([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]])
        known = ~np.isnan(stack)
        total = np.where(known, stack, 0.0).sum(axis=0)
        count = known.sum(axis=0)
        mean = np.divide(total, count, out=np.zeros_like(total), where=count > 0)
        fillable = empty & (count > 0)
        grid[fillable] = mean[fillable]
    grid = np.nan_to_num(grid, nan=0.0)

    filled = Image.fromarray(np.clip(grid, 0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return filled


def build() -> Path:
    src = Image.open(SOURCE).convert("RGB")
    mask = _ink_mask(src)
    covered = mask.mean()
    if covered > 0.12:
        raise SystemExit(f"mask covers {covered:.1%} of the frame; the regions are wrong")
    print(f"  repairing {covered:.1%} of the frame")
    filled = _diffuse_fill(src, mask, scale=4)
    brain = _brain_mask(src)
    print(f"  lifting the drawn brain: {brain.mean():.2%} of the frame")
    filled = _diffuse_fill(filled, brain, scale=1, rounds=300)

    # Replace the ink solidly, then dissolve the correction into the photograph just outside
    # it. A blurred alpha alone would leave thin strokes half-transparent, which is exactly
    # the ghosted letterpress look this is meant to remove. The brain strokes are thinner and
    # sit on a soft shadow, so they get a tighter rim: a wide one would ring every line.
    def _alpha(m: np.ndarray, radius: int, feather: float) -> np.ndarray:
        core = _dilate(m, radius)
        soft = np.asarray(
            Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(feather))
        ).astype(np.float32) / 255.0
        return np.maximum(soft, core.astype(np.float32))

    alpha = np.maximum(_alpha(mask, 3, 3.0), _alpha(brain, 3, 1.8))[..., None]
    base = np.asarray(src).astype(np.float32)
    patch = np.asarray(filled).astype(np.float32)
    rng = np.random.default_rng(7)
    grain = rng.normal(0.0, 2.2, base.shape).astype(np.float32)
    out = base * (1.0 - alpha) + (patch + grain) * alpha

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT, quality=90, optimize=True)
    return OUT


def main() -> int:
    if not SOURCE.exists():
        print(f"missing {SOURCE}")
        return 1
    path = build()
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
