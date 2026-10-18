// A small brain viewer for the upload and overview screens. The viewer itself belongs to the
// 3D agent, so this file only loads it if the module is on disk: import.meta.glob resolves at
// build time and gives an empty map when the file is absent, which keeps the build green and
// shows a plain fallback card instead.

import { Component, Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { Loading, ModelLabel } from "@/components/common";

/** The layers the viewer understands. It owns this vocabulary, so only pass one of these. */
type CompactLayer = "damage" | "activity" | "ei";

interface ViewerProps {
  patientId: string;
  week: number;
  layer: CompactLayer;
  compact: boolean;
}

type ViewerModule = Record<string, unknown>;

const modules = import.meta.glob<ViewerModule>("../brain/*.tsx");
const entry = Object.entries(modules).find(([path]) => path.endsWith("/BrainViewer.tsx"));

const Viewer: ComponentType<ViewerProps> | null = entry
  ? lazy(async () => {
      const mod = await entry[1]();
      const found = (mod.BrainViewer ?? mod.default) as ComponentType<ViewerProps> | undefined;
      if (!found) throw new Error("BrainViewer has no component export");
      return { default: found };
    })
  : null;

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="science-grid flex min-h-56 items-center justify-center rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

interface GuardState {
  failed: boolean;
}

/** Keeps a viewer crash, for example no WebGL, from taking the whole screen down. */
class Guard extends Component<{ children: ReactNode }, GuardState> {
  override state: GuardState = { failed: false };

  static getDerivedStateFromError(): GuardState {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <Placeholder>The 3D viewer could not start on this device. Every number on this page still works.</Placeholder>;
    }
    return this.props.children;
  }
}

export function CompactTwin({
  patientId,
  week,
  layer = "damage",
}: {
  patientId: string;
  week: number;
  layer?: CompactLayer;
}) {
  if (!Viewer) {
    return <Placeholder>The 3D brain viewer is not installed in this build yet.</Placeholder>;
  }
  return (
    <div className="workspace-visual">
      <Guard>
        <Suspense fallback={<Loading label="Loading the brain viewer" />}>
          <Viewer patientId={patientId} week={week} layer={layer} compact />
        </Suspense>
      </Guard>
      <ModelLabel className="mt-2" />
    </div>
  );
}
