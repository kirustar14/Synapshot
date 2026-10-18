"""A schematic vessel layout, in the same millimetre space as the cortical surface.

What this is: the dural venous sinuses, the deep venous system, the named superficial
cortical veins and the main arterial trunks, drawn as polylines through anatomical
landmarks in MNI space. It is a diagram, at atlas scale, in the same coordinate frame as
the mesh so it sits where it should relative to the cortex.

What this is not: this patient's vessels. Nobody's venous anatomy matches a textbook, the
superficial veins vary more than almost anything else in the head, and no angiogram went
into this. The caption on the layer says so and the payload repeats it, because a
rendered vessel next to a rendered brain is exactly the sort of thing that gets mistaken
for a scan.

Coordinates are MNI152 millimetres, right-handed: +x right, +y anterior, +z superior.
They were placed from the standard descriptions of each vessel's course, and are accurate
to roughly where these structures sit, not to a millimetre.
"""

import json
from pathlib import Path

from ..config import ROOT

OUT = ROOT / "backend" / "data" / "vessels.json"

CAPTION = ("Schematic vessel layout from anatomical atlases. Not patient-specific.")

# Each vessel: name, group, a short description, radius in mm at its widest, and the
# polyline it follows. Radii are the usual adult calibre of the vessel, used only to set
# how thick it is drawn.
VESSELS: list[dict] = [

    # ---------------------------------------------------------------- dural sinuses
    {
        "name": "Superior sagittal sinus",
        "group": "dural_sinus",
        "about": "Runs back along the attached margin of the falx, in the midline, from "
                 "the crista galli to the confluence of sinuses.",
        "radius_mm": 5.0,
        "points": [
            [0, 72, 18], [0, 66, 36], [0, 54, 52], [0, 36, 66], [0, 14, 76],
            [0, -10, 78], [0, -34, 72], [0, -56, 56], [0, -72, 34], [0, -80, 12],
            [0, -84, -4],
        ],
    },
    {
        "name": "Inferior sagittal sinus",
        "group": "dural_sinus",
        "about": "In the free lower margin of the falx, above the corpus callosum, "
                 "joining the great cerebral vein to form the straight sinus.",
        "radius_mm": 2.0,
        "points": [
            [0, 34, 20], [0, 22, 30], [0, 4, 36], [0, -16, 36], [0, -32, 28],
        ],
    },
    {
        "name": "Straight sinus",
        "group": "dural_sinus",
        "about": "Runs back and down in the junction of the falx and tentorium, from the "
                 "great cerebral vein to the confluence.",
        "radius_mm": 3.5,
        "points": [[0, -32, 28], [0, -48, 16], [0, -66, 4], [0, -84, -4]],
    },
    {
        "name": "Transverse sinus, left",
        "group": "dural_sinus",
        "about": "From the confluence, laterally in the attached margin of the tentorium "
                 "along the occipital bone.",
        "radius_mm": 4.5,
        "points": [[0, -84, -4], [-18, -82, -4], [-36, -74, -6], [-50, -60, -8],
                   [-58, -44, -12]],
    },
    {
        "name": "Transverse sinus, right",
        "group": "dural_sinus",
        "about": "The right transverse sinus is usually the larger of the two and "
                 "usually drains the superior sagittal sinus.",
        "radius_mm": 5.0,
        "points": [[0, -84, -4], [18, -82, -4], [36, -74, -6], [50, -60, -8],
                   [58, -44, -12]],
    },
    {
        "name": "Sigmoid sinus, left",
        "group": "dural_sinus",
        "about": "The S-shaped continuation of the transverse sinus, curving down and "
                 "forward to the jugular bulb.",
        "radius_mm": 4.5,
        "points": [[-58, -44, -12], [-60, -34, -22], [-56, -26, -34], [-46, -18, -42],
                   [-38, -12, -46]],
    },
    {
        "name": "Sigmoid sinus, right",
        "group": "dural_sinus",
        "about": "As on the left, continuing into the internal jugular vein.",
        "radius_mm": 5.0,
        "points": [[58, -44, -12], [60, -34, -22], [56, -26, -34], [46, -18, -42],
                   [38, -12, -46]],
    },
    {
        "name": "Cavernous sinus, left",
        "group": "dural_sinus",
        "about": "Beside the sella, carrying the internal carotid artery and the third, "
                 "fourth, sixth and two branches of the fifth cranial nerve through it.",
        "radius_mm": 3.0,
        "points": [[-12, 8, -22], [-14, 0, -24], [-14, -8, -24]],
    },
    {
        "name": "Cavernous sinus, right",
        "group": "dural_sinus",
        "about": "The right cavernous sinus, communicating with the left across the "
                 "midline in front of and behind the pituitary.",
        "radius_mm": 3.0,
        "points": [[12, 8, -22], [14, 0, -24], [14, -8, -24]],
    },

    # ---------------------------------------------------------------- deep veins
    {
        "name": "Great cerebral vein of Galen",
        "group": "deep_vein",
        "about": "A short midline trunk under the splenium, formed by the two internal "
                 "cerebral veins and the basal veins, draining into the straight sinus.",
        "radius_mm": 2.5,
        "points": [[0, -26, 20], [0, -30, 25], [0, -32, 28]],
    },
    {
        "name": "Internal cerebral vein, left",
        "group": "deep_vein",
        "about": "Runs back in the roof of the third ventricle, close to the midline, "
                 "joining its fellow to form the vein of Galen.",
        "radius_mm": 1.6,
        "points": [[-4, 6, 18], [-4, -6, 20], [-3, -16, 21], [-1, -24, 20]],
    },
    {
        "name": "Internal cerebral vein, right",
        "group": "deep_vein",
        "about": "The right internal cerebral vein, paired with the left.",
        "radius_mm": 1.6,
        "points": [[4, 6, 18], [4, -6, 20], [3, -16, 21], [1, -24, 20]],
    },
    {
        "name": "Basal vein of Rosenthal, left",
        "group": "deep_vein",
        "about": "Begins at the anterior perforated substance, curves round the midbrain "
                 "and joins the vein of Galen.",
        "radius_mm": 1.6,
        "points": [[-22, 6, -16], [-28, -4, -14], [-28, -16, -8], [-20, -24, 2],
                   [-8, -26, 14], [-2, -26, 19]],
    },
    {
        "name": "Basal vein of Rosenthal, right",
        "group": "deep_vein",
        "about": "The right basal vein, taking the same course round the midbrain.",
        "radius_mm": 1.6,
        "points": [[22, 6, -16], [28, -4, -14], [28, -16, -8], [20, -24, 2],
                   [8, -26, 14], [2, -26, 19]],
    },
    {
        "name": "Thalamostriate vein, left",
        "group": "deep_vein",
        "about": "Runs in the groove between the thalamus and the caudate, turning "
                 "sharply at the venous angle to join the internal cerebral vein.",
        "radius_mm": 1.2,
        "points": [[-18, -22, 14], [-14, -12, 16], [-8, -2, 18], [-4, 6, 18]],
    },
    {
        "name": "Thalamostriate vein, right",
        "group": "deep_vein",
        "about": "The right thalamostriate vein, mirroring the left.",
        "radius_mm": 1.2,
        "points": [[18, -22, 14], [14, -12, 16], [8, -2, 18], [4, 6, 18]],
    },

    # ---------------------------------------------------------------- cortical veins
    {
        "name": "Superficial middle cerebral vein, left",
        "group": "cortical_vein",
        "about": "Runs forward along the Sylvian fissure to drain into the cavernous or "
                 "sphenoparietal sinus.",
        "radius_mm": 1.8,
        "points": [[-54, -34, 14], [-58, -18, 10], [-56, -2, 4], [-46, 10, -6],
                   [-30, 14, -16], [-16, 8, -22]],
    },
    {
        "name": "Superficial middle cerebral vein, right",
        "group": "cortical_vein",
        "about": "The right Sylvian vein, taking the same course.",
        "radius_mm": 1.8,
        "points": [[54, -34, 14], [58, -18, 10], [56, -2, 4], [46, 10, -6],
                   [30, 14, -16], [16, 8, -22]],
    },
    {
        "name": "Vein of Trolard, left",
        "group": "cortical_vein",
        "about": "The superior anastomotic vein: the largest link from the Sylvian vein "
                 "up to the superior sagittal sinus, usually crossing the parietal lobe.",
        "radius_mm": 1.8,
        "points": [[-56, -22, 12], [-52, -24, 30], [-42, -26, 48], [-26, -26, 62],
                   [-10, -24, 72], [0, -22, 76]],
    },
    {
        "name": "Vein of Trolard, right",
        "group": "cortical_vein",
        "about": "The right superior anastomotic vein. Trolard and Labbe are reciprocal: "
                 "where one is large the other is usually small.",
        "radius_mm": 1.8,
        "points": [[56, -22, 12], [52, -24, 30], [42, -26, 48], [26, -26, 62],
                   [10, -24, 72], [0, -22, 76]],
    },
    {
        "name": "Vein of Labbe, left",
        "group": "cortical_vein",
        "about": "The inferior anastomotic vein: from the Sylvian vein back across the "
                 "temporal lobe to the transverse sinus.",
        "radius_mm": 1.6,
        "points": [[-56, -20, 8], [-58, -34, 2], [-56, -48, -2], [-50, -58, -6],
                   [-56, -46, -11]],
    },
    {
        "name": "Vein of Labbe, right",
        "group": "cortical_vein",
        "about": "The right inferior anastomotic vein, draining into the right transverse "
                 "sinus, which is usually the dominant one.",
        "radius_mm": 1.8,
        "points": [[56, -20, 8], [58, -34, 2], [56, -48, -2], [50, -58, -6],
                   [56, -46, -11]],
    },
    {
        "name": "Frontal bridging veins, left",
        "group": "cortical_vein",
        "about": "Short veins crossing the subdural space to enter the superior sagittal "
                 "sinus. These are the ones that tear in an acceleration injury.",
        "radius_mm": 1.0,
        "points": [[-30, 50, 28], [-20, 52, 44], [-10, 48, 60], [-2, 42, 68]],
    },
    {
        "name": "Frontal bridging veins, right",
        "group": "cortical_vein",
        "about": "The right frontal bridging veins, entering the sinus against the "
                 "direction of blood flow, which is why they are vulnerable.",
        "radius_mm": 1.0,
        "points": [[30, 50, 28], [20, 52, 44], [10, 48, 60], [2, 42, 68]],
    },
    {
        "name": "Parieto-occipital bridging veins, left",
        "group": "cortical_vein",
        "about": "Posterior bridging veins entering the superior sagittal sinus.",
        "radius_mm": 1.0,
        "points": [[-26, -62, 40], [-16, -66, 54], [-6, -66, 64], [-1, -62, 70]],
    },
    {
        "name": "Parieto-occipital bridging veins, right",
        "group": "cortical_vein",
        "about": "The right posterior bridging veins.",
        "radius_mm": 1.0,
        "points": [[26, -62, 40], [16, -66, 54], [6, -66, 64], [1, -62, 70]],
    },

    # ---------------------------------------------------------------- arteries
    {
        "name": "Internal carotid artery, left",
        "group": "artery",
        "about": "Enters the skull base, turns through the cavernous sinus in the carotid "
                 "siphon, and divides into the anterior and middle cerebral arteries.",
        "radius_mm": 2.5,
        "points": [[-20, -6, -46], [-18, 2, -36], [-16, 10, -28], [-14, 14, -20],
                   [-18, 12, -12], [-22, 8, -8]],
    },
    {
        "name": "Internal carotid artery, right",
        "group": "artery",
        "about": "The right internal carotid, taking the same course through the siphon.",
        "radius_mm": 2.5,
        "points": [[20, -6, -46], [18, 2, -36], [16, 10, -28], [14, 14, -20],
                   [18, 12, -12], [22, 8, -8]],
    },
    {
        "name": "Middle cerebral artery, left",
        "group": "artery",
        "about": "The largest branch of the carotid. Runs laterally into the Sylvian "
                 "fissure and fans out over the insula and the convexity.",
        "radius_mm": 2.0,
        "points": [[-22, 8, -8], [-32, 6, -4], [-42, 2, 2], [-52, -6, 8],
                   [-56, -20, 14], [-52, -36, 20]],
    },
    {
        "name": "Middle cerebral artery, right",
        "group": "artery",
        "about": "The right middle cerebral artery and its Sylvian course.",
        "radius_mm": 2.0,
        "points": [[22, 8, -8], [32, 6, -4], [42, 2, 2], [52, -6, 8],
                   [56, -20, 14], [52, -36, 20]],
    },
    {
        "name": "Anterior cerebral artery, left",
        "group": "artery",
        "about": "Runs forward and up round the genu of the corpus callosum, supplying "
                 "the medial frontal lobe.",
        "radius_mm": 1.6,
        "points": [[-22, 8, -8], [-10, 18, -8], [-4, 30, 0], [-3, 38, 14],
                   [-3, 34, 28], [-3, 18, 36], [-3, -8, 38], [-3, -30, 34]],
    },
    {
        "name": "Anterior cerebral artery, right",
        "group": "artery",
        "about": "The right anterior cerebral artery, joined to the left by the anterior "
                 "communicating artery.",
        "radius_mm": 1.6,
        "points": [[22, 8, -8], [10, 18, -8], [4, 30, 0], [3, 38, 14],
                   [3, 34, 28], [3, 18, 36], [3, -8, 38], [3, -30, 34]],
    },
    {
        "name": "Basilar artery",
        "group": "artery",
        "about": "Formed by the two vertebral arteries, runs up the front of the pons and "
                 "divides into the posterior cerebral arteries.",
        "radius_mm": 2.0,
        "points": [[0, -28, -48], [0, -26, -40], [0, -24, -32], [0, -20, -24]],
    },
    {
        "name": "Posterior cerebral artery, left",
        "group": "artery",
        "about": "Curves round the midbrain to supply the occipital lobe and the "
                 "inferomedial temporal lobe.",
        "radius_mm": 1.6,
        "points": [[0, -20, -24], [-12, -24, -20], [-22, -34, -14], [-24, -50, -6],
                   [-18, -66, 2], [-10, -78, 6]],
    },
    {
        "name": "Posterior cerebral artery, right",
        "group": "artery",
        "about": "The right posterior cerebral artery, from the basilar tip.",
        "radius_mm": 1.6,
        "points": [[0, -20, -24], [12, -24, -20], [22, -34, -14], [24, -50, -6],
                   [18, -66, 2], [10, -78, 6]],
    },
]

GROUPS = {
    "dural_sinus": {
        "label": "Dural sinuses",
        "colour": "#3b82f6",
        "about": "The large venous channels between the layers of the dura.",
    },
    "deep_vein": {
        "label": "Deep veins",
        "colour": "#60a5fa",
        "about": "The internal cerebral, basal and great cerebral veins, draining the "
                 "deep white matter and the basal ganglia.",
    },
    "cortical_vein": {
        "label": "Cortical veins",
        "colour": "#93c5fd",
        "about": "Superficial veins on the surface, including the named anastomotic "
                 "veins of Trolard and Labbe and the bridging veins that tear in an "
                 "acceleration injury.",
    },
    "artery": {
        "label": "Arteries",
        "colour": "#ef4444",
        "about": "The carotid and vertebrobasilar trunks and their main branches. Off by "
                 "default: in a head injury the venous side is what usually matters.",
    },
}


def payload() -> dict:
    """The vessels contract object."""
    out = []
    for v in VESSELS:
        out.append({
            "name": v["name"],
            "group": v["group"],
            "about": v["about"],
            "radius_mm": float(v["radius_mm"]),
            "points": [[float(x) for x in p] for p in v["points"]],
        })
    return {
        "vessels": out,
        "groups": GROUPS,
        "space": "MNI152 millimetres, same frame as /api/mesh",
        "caption": CAPTION,
        "note": "Polylines through anatomical landmarks, at atlas scale. No angiogram "
                "went into this and it is not anyone's own anatomy. Superficial venous "
                "anatomy varies more than almost anything else in the head.",
    }


def build(path: Path = OUT) -> dict:
    """Write vessels.json, which is what the route serves."""
    got = payload()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(got, indent=1) + "\n")
    return got


def load() -> dict:
    """The stored layout, building it if it is not on disk."""
    if OUT.exists():
        try:
            return json.loads(OUT.read_text())
        except Exception:
            pass
    return build()


def bounds() -> tuple[list[float], list[float]]:
    """The bounding box of every point, for the test that keeps these inside a head."""
    xs = [p[i] for v in VESSELS for p in v["points"] for i in range(1)]
    ys = [p[1] for v in VESSELS for p in v["points"]]
    zs = [p[2] for v in VESSELS for p in v["points"]]
    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def main() -> int:
    """Write the file and print what went into it."""
    got = build()
    lo, hi = bounds()
    print("")
    print(f"  {len(got['vessels'])} vessels in {len(got['groups'])} groups "
          f"-> {OUT.relative_to(ROOT)}")
    for key, meta in got["groups"].items():
        rows = [v for v in got["vessels"] if v["group"] == key]
        print(f"    {meta['label']:18s} {len(rows)}")
    print(f"  bounding box x {lo[0]:.0f} to {hi[0]:.0f}, "
          f"y {lo[1]:.0f} to {hi[1]:.0f}, z {lo[2]:.0f} to {hi[2]:.0f} mm")
    print(f"  {CAPTION}")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
