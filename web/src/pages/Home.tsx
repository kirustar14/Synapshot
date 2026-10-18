// The landing page. A wordmark, a line that says what the thing is, a brain turning on
// its own, and the two places you can go. Nothing else: this is the first screen in the
// demo and every extra control on it is a thing somebody has to decide not to click.

import { ArrowRight, Plus } from "lucide-react";
import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// three, drei and postprocessing are the biggest thing in the bundle. Lazy, so the first
// paint is text and the canvas arrives behind it.
const BrainViewer = lazy(() => import("@/components/brain/BrainViewer"));

/** What fills the frame while the viewer chunk loads. Same colours, so nothing jumps. */
function Placeholder() {
  return (
    <div className="h-full w-full rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(56,189,248,0.22),rgba(7,14,18,0)_68%)]" />
  );
}

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#070e12] text-cyan-50">
      {/* The hologram sits behind the words rather than beside them, so on a narrow
          screen the layout does not have to choose between them. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[min(88vh,760px)] w-[min(88vw,760px)] opacity-[0.55]">
          <Suspense fallback={<Placeholder />}>
            <BrainViewer patientId="" spin bare compact height={760} />
          </Suspense>
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(7,14,18,0.1),rgba(7,14,18,0.92)_72%)]"
        aria-hidden
      />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-5xl font-black tracking-tight sm:text-7xl">
          Synapshot<span className="text-cyan-400">.</span>
        </h1>
        <p className="mt-4 max-w-xl text-lg text-cyan-100/80 sm:text-xl">A snapshot of your brain, every week.</p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="min-w-52">
            <Link to="/clinic">
              Open the clinic
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-w-52 border-cyan-300/30 bg-black/30 text-cyan-50 hover:bg-cyan-400/10">
            <Link to="/patients/new">
              <Plus aria-hidden />
              Add a patient
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
