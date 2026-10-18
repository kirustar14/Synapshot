// What the workspace imports. BrainViewer is deliberately absent: a page must pull it
// through React.lazy so three, drei and postprocessing stay out of the main chunk.
//
// The panels that used to hang off this barrel went with the pages they belonged to.
// SidePanels went with them: it held a second copy of the region card, the tract list
// and the person summary, all four exports unreachable since the five screens became one
// workspace. A second copy of a panel nobody can open is a copy that drifts.
//
// What is left is what the one-screen workspace actually uses: the shape slider and the
// pure data helpers, which have no three import and so can be used from a tab without
// dragging the 3D bundle in with them.

export { ShapeControls } from "./ShapeControls";
export { LAYERS, LAYER_BY_ID, rampColor, rampGradient, type LayerId } from "./layers";
export {
  REGIONS,
  atWeek,
  globalDamage,
  layerValues,
  regionLabel,
  regionPoints,
  topDamaged,
  weightsFromAttribution,
  type LayerValues,
} from "./regionData";
export { RECEPTOR_TARGETS, WEEK_MAX, useViewer, type ViewPreset } from "./viewerStore";
export type { BrainViewerProps } from "./BrainViewer";
