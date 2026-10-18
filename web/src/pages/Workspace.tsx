// The patient workspace. Everything about one patient, on one screen.
//
// Three zones, fixed:
//
//   top bar     who they are, and the two things you can do
//   left rail   the facts, the flags and when the next call is
//   centre      the brain, which never leaves the screen
//   right       four tabs: Data, Analysis, Treatment, Timeline
//
// This replaces five separate pages. The overview, the twin viewer, the scenario
// compare, the call log and the alerts list were all about the same patient and all made
// you leave the brain behind to read them. Nothing in that list was deleted; it moved
// into a tab beside the thing it is about.
//
// The brain staying put is the point. A clinician reading the Analysis tab can see the
// region the forecast is about without navigating, and clicking a region in the Data tab
// moves the brain rather than opening a different screen.

import { createContext, useContext, useState } from "react";
import { useParams } from "react-router-dom";
import { usePatient } from "@/api/client";
import { usePatientStream } from "@/api/stream";
import { ErrorState, Loading } from "@/components/common";
import { CallModal } from "@/components/workspace/CallModal";
import { CenterBrain } from "@/components/workspace/CenterBrain";
import { EvidenceDrawer } from "@/components/workspace/EvidenceDrawer";
import { LeftRail } from "@/components/workspace/LeftRail";
import { RightPanel } from "@/components/workspace/RightPanel";
import { TopBar } from "@/components/workspace/TopBar";

export type TabId = "data" | "analysis" | "treatment" | "timeline";

interface Ctx {
  id: string;
  tab: TabId;
  setTab: (t: TabId) => void;
  /** Week the viewer is showing. The scrubber and the timeline both drive it. */
  week: number;
  setWeek: (w: number) => void;
  /** Region the panels are focused on, or null. Set by clicking the brain or a row. */
  region: number | null;
  setRegion: (r: number | null) => void;
  /** Replaces the brain's layer values, used by the Treatment tab's difference mode. */
  overlay: { values: number[]; unclear?: boolean[]; label: string; diverging: boolean } | null;
  setOverlay: (o: Ctx["overlay"]) => void;
  openEvidence: (section?: string) => void;
}

const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const got = useContext(WorkspaceContext);
  if (!got) throw new Error("useWorkspace outside the workspace");
  return got;
}

export default function Workspace() {
  const { id = "" } = useParams();
  const patient = usePatient(id);

  const [tab, setTab] = useState<TabId>("data");
  const [week, setWeek] = useState(0);
  const [region, setRegion] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<Ctx["overlay"]>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  // One stream per open workspace. It is what makes a call land here without a reload:
  // frames while it runs, stages while it processes, then one call_done.
  const stream = usePatientStream(id, true);

  if (patient.isLoading) return <Loading label="Loading the patient" />;
  if (patient.error || !patient.data) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
        <ErrorState error={patient.error} onRetry={() => patient.refetch()} />
      </main>
    );
  }

  const ctx: Ctx = {
    id,
    tab,
    setTab,
    week,
    setWeek,
    region,
    setRegion,
    overlay,
    setOverlay,
    openEvidence: (section?: string) => setEvidence(section ?? ""),
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      {/* One screen means one screen. Without a hard height the grid's `flex-1` grows
          past the viewport, the page scrolls, and the brain ends up half below the fold,
          which is the one thing this layout exists to prevent. 4rem is the shell header;
          dvh rather than vh so a phone's collapsing address bar does not cut it off. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
      <TopBar
        patient={patient.data}
        onCall={() => setCalling(true)}
        onEvidence={() => setEvidence("")}
        stream={stream}
      />

      {/* Three columns on a desk, stacked on a phone. The brain is first in the DOM
          after the rail so it is the first thing a screen reader reaches after the
          facts, and `min-h-0` on the grid is what lets the panels scroll inside their
          own column instead of the page growing. */}
      {/* Below lg the three zones are plain stacked blocks at their natural height and
          the page scrolls. Above it they become fixed height columns that scroll inside
          themselves, which is what makes the brain stay put while a tab is read. Trying
          to do both at once was what made them overlap on a phone. */}
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)_380px] lg:overflow-hidden lg:px-6 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
        <LeftRail patient={patient.data} stream={stream} />
        <CenterBrain patient={patient.data} />
        <RightPanel patient={patient.data} />
      </div>
      </div>

      <CallModal
        patient={patient.data}
        open={calling}
        onClose={() => setCalling(false)}
        stream={stream}
      />
      <EvidenceDrawer
        open={evidence !== null}
        section={evidence ?? ""}
        onClose={() => setEvidence(null)}
      />
    </WorkspaceContext.Provider>
  );
}
