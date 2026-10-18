// What the pages import. BrainViewer is deliberately absent: a page must pull it through
// React.lazy so three, drei and postprocessing stay out of the main chunk.

export { AttributionPanel, HypothesisBadge } from "./AttributionPanel";
export { CounterfactualPanel } from "./CounterfactualPanel";
export { LayerSwitcher, Legend } from "./LayerSwitcher";
export { PersonPanel, RegionPanel, TractPanel, WhereItHurts, receptorMap } from "./SidePanels";
export { ShapeControls } from "./ShapeControls";
export { DamageTimeline, ReplayControls, WeekScrubber } from "./TimeControls";
export { WhatIfBanner, WhatIfPanel } from "./WhatIfPanel";
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
export { RECEPTOR_TARGETS, WEEK_MAX, useViewer } from "./viewerStore";
export type { BrainViewerProps } from "./BrainViewer";
