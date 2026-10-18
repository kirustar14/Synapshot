// What the workspace imports. BrainViewer is deliberately absent: a page must pull it
// through React.lazy so three, drei and postprocessing stay out of the main chunk.
//
// The panels that used to hang off this barrel went with the pages they belonged to.
// What is left is what the one-screen workspace actually uses: the region card, the
// shape slider, and the pure data helpers that have no three import and so can be used
// from a tab without dragging the 3D bundle in with them.

export { PersonPanel, RegionPanel, TractPanel, WhereItHurts, receptorMap } from "./SidePanels";
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
