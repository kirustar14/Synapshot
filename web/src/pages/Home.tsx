// The landing page. A wordmark, a line that says what the thing is, a brain turning on
// its own, and the two places you can go. Nothing else: this is the first screen in the
// demo and every extra control on it is a thing somebody has to decide not to click.

import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* The thin mono strip. It is the one place the framing is said on this screen. */}
      <div className="status-strip relative z-20 px-4 py-2 text-muted-foreground">
        SYNAPSHOT &middot; DEMO MODE &middot; SYNTHETIC PATIENT
      </div>

      {/* The brain used to sit behind the words here. It is gone: the headline is the
          thing to read on this screen, and a rendered cortex behind it was competing
          with it for the one thing a landing page has to do. The brain is the whole
          point of the workspace, which is one click away. */}

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
