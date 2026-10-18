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
  return <div className="h-full w-full rounded-full bg-muted/40" />;
}

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* The thin mono strip. It is the one place the framing is said on this screen. */}
      <div className="status-strip relative z-20 px-4 py-2 text-muted-foreground">
        SYNAPSHOT &middot; DEMO MODE &middot; SYNTHETIC PATIENT
      </div>

      {/* The brain sits behind the words rather than beside them, so a narrow screen does
          not have to choose between them. No vessels here: the hero is a portrait, not a
          diagram, and a rendered vessel next to a rendered brain reads as an angiogram. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="mt-[14vh] h-[min(74vh,660px)] w-[min(74vw,660px)] opacity-100">
          <Suspense fallback={<Placeholder />}>
            <BrainViewer patientId="" spin bare compact height={720} />
          </Suspense>
        </div>
      </div>

      {/* A soft ground shadow instead of a dark box. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-[14%] mx-auto h-10 w-[min(46vw,420px)] rounded-[50%] bg-foreground/[0.07] blur-2xl"
        aria-hidden
      />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="display text-6xl sm:text-8xl">
          A snapshot of your <span className="display-em">brain</span>, every week
        </h1>
        <p className="mt-6 max-w-xl text-base text-foreground/70 sm:text-lg">
          A personal brain twin for traumatic brain injury, measured from a weekly check-in
          the patient runs on their own phone.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="min-w-52">
            <Link to="/clinic">
              Open clinic
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-w-52">
            <Link to="/patients/new">
              <Plus aria-hidden />
              Add patient
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
