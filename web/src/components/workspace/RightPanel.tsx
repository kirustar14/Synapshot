// Zone four: four tabs, and only four.
//
//   Data        what is known about this patient, and where each fact came from
//   Analysis    what the model makes of it, with its bands
//   Treatment   the drug what-if
//   Timeline    what happened, on a calendar
//
// The rule that keeps it to four: a tab is a kind of question, not a feature. "Where did
// this number come from" is Data. "What does the model think" is Analysis. Anything that
// does not answer one of those four questions belongs in one of them, not in a fifth.

import type { Patient } from "@/api/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalysisTab } from "@/components/workspace/tabs/AnalysisTab";
import { DataTab } from "@/components/workspace/tabs/DataTab";
import { TimelineTab } from "@/components/workspace/tabs/TimelineTab";
import { TreatmentTab } from "@/components/workspace/tabs/TreatmentTab";
import { useWorkspace, type TabId } from "@/pages/Workspace";

const TABS: { id: TabId; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "analysis", label: "Analysis" },
  { id: "treatment", label: "Treatment" },
  { id: "timeline", label: "Timeline" },
];

export function RightPanel({ patient }: { patient: Patient }) {
  const { tab, setTab } = useWorkspace();

  return (
    <aside className="order-3 flex flex-col rounded-2xl border border-border/70 bg-card lg:min-h-0 lg:overflow-hidden">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="m-2 grid shrink-0 grid-cols-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Each tab owns its own scroll, so switching tabs does not move the page and
            the brain beside it never shifts. */}
        <TabsContent value="data" className="px-3 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <DataTab patient={patient} />
        </TabsContent>
        <TabsContent value="analysis" className="px-3 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <AnalysisTab patient={patient} />
        </TabsContent>
        <TabsContent value="treatment" className="px-3 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <TreatmentTab patient={patient} />
        </TabsContent>
        <TabsContent value="timeline" className="px-3 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <TimelineTab patient={patient} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
