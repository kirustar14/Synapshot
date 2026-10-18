// Compact shell for document intake and the consolidated patient workspace. The dashboard
// retains its own navigation; both shells share the same backend session.

import { Laptop, LogOut, Moon, Smartphone, Sun } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { useSignOut } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/store/app";

/** The wordmark, which is also the way back to the landing page. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link to="/" aria-label="Synapshot home" className={className}>
      {/* Serif wordmark, then the thing it is, in mono, the way a masthead reads. */}
      <span className="display text-xl">Synapshot</span>
      <span className="eyebrow ml-2 text-muted-foreground">Brain twin for TBI</span>
    </Link>
  );
}

/**
 * The demo mode switch.
 *
 * On means the next check-in runs here, on this laptop's webcam, through the same ingest
 * and the same pipeline a phone goes through. Off means the patient gets a text with a
 * link and does it on their own phone. It changes who holds the camera and nothing else,
 * which is the only reason it is safe to have on a clinician's screen.
 */
export function DemoSwitch() {
  const on = useApp((s) => s.demoMode);
  const set = useApp((s) => s.setDemoMode);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1.5">
          {on ? <Laptop className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Smartphone className="h-3.5 w-3.5" aria-hidden />}
          <Label htmlFor="demo-mode" className="eyebrow cursor-pointer">
            Demo mode
          </Label>
          <Switch id="demo-mode" checked={on} onCheckedChange={set} aria-label="Run the check-in on this laptop" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {on
          ? "The check-in runs here on this laptop's webcam, through the same measurement code a phone runs."
          : "The patient gets a text with a link and does the check-in on their own phone."}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceLayout() {
  const dark = useApp((s) => s.dark);
  const setDark = useApp((s) => s.setDark);
  const logout = useSignOut();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="no-print sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur lg:px-8">
        <Wordmark />
        <Link to="/app" className="text-xs text-muted-foreground hover:underline">Dashboard</Link>
        <Link to="/clinic" className="text-xs text-muted-foreground hover:underline">Clinic</Link>

        <div className="ml-auto flex items-center gap-2">
          <DemoSwitch />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDark(!dark)}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void logout()}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
