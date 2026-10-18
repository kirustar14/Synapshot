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

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useLatestUpdate, usePatient } from "@/api/client";
import { usePatientStream } from "@/api/stream";
import { UpdateBanner } from "@/components/workspace/UpdateBanner";
import { useViewer } from "@/components/brain";
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
  /**
   * The region the panels are focused on, or null.
   *
   * This is the viewer's own `selected`, not a copy of it. Keeping a second one here
   * meant clicking a parcel on the brain set the viewer's and left the workspace's
   * untouched, so the selection chip never appeared and no tab ever heard about it.
   * One store, one truth.
   */
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
  const region = useViewer((s) => s.selected);
  const setRegion = useViewer((s) => s.setSelected);
  const [overlay, setOverlay] = useState<Ctx["overlay"]>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  // One stream per open workspace. It is what makes a call land here without a reload:
  // frames while it runs, stages while it processes, then one call_done.
  const stream = usePatientStream(id, true);

  // What the last call changed, for the banner. Read from the endpoint rather than held
  // from the stream event, so a page opened after the call says the same thing as one
  // that was already open when it landed. Dismissing records which call was closed, so
  // the next one shows again rather than the banner being gone for good.
  const update = useLatestUpdate(id);
  const [dismissed, setDismissed] = useState("");
  const seen = useRef("");
  const client = useQueryClient();

  // The refetch that was described in a comment and never written. Everything the call
  // touched is refetched here: the patient row, the twin the brain is drawn from, the
  // shape, the forecast, the alerts and the timeline. Without it the charts and the
  // brain both sat on whatever they had loaded when the page opened.
  useEffect(() => {
    const done = stream.done;
    if (!done || seen.current === done.call_id) return;
    seen.current = done.call_id;
    for (const key of ["patient", "twin", "shape", "forecast", "alerts", "timeline",
                       "checkins", "latest-update", "attribution", "percentile"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  }, [client, stream.done]);

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

      <UpdateBanner
        update={update.data && update.data.call_id !== dismissed ? update.data : null}
        onClose={() => setDismissed(update.data?.call_id ?? "")}
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

      {/* One of the three places the framing is kept. It is invisible on screen and on
          every printed page, which is the version that leaves the building and the one
          most likely to be read by somebody who never saw the Evidence drawer. */}
      <footer className="hidden print:block border-t pt-2 text-[9px] leading-snug text-muted-foreground">
        Synapshot, {patient.data.name}, week {patient.data.week} of 12. Research prototype,
        not a medical device. This patient is synthetic and is not a real person. The brain
        is a model output and not a scan. Nothing here is a diagnosis or a clearance
        decision.
      </footer>
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
