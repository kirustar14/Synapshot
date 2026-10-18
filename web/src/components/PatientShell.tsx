// Shell for the patient facing routes. Mobile first, single column, no sidebar, readable at
// 360px. Used by the consent page, the phone mock, the stretch tests and the call page.

import { Brain } from "lucide-react";
import type { ReactNode } from "react";

export function PatientShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/15 bg-primary-soft text-primary">
          <Brain className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-black leading-tight">
            Synapshot<span className="text-primary">.</span>
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{title}</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[460px] px-5 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-[460px] px-5 pb-10 text-[11px] leading-relaxed text-muted-foreground">
        This is research software. Nothing here is a diagnosis and nothing here replaces your doctor. If you feel worse at
        any time, call your clinic or your local emergency number.
      </footer>
    </div>
  );
}
