import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, Brain, Gamepad2, Menu, Moon, Radio, Sun, Users, LineChart, LogOut, FlaskConical, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useAlerts, useHealth } from "@/api/client";
import { AuthGate, authEnabled, useLogout } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_clinic")({
  ssr: false,
  component: ClinicLayout,
});

function ClinicLayout() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const unlocked = useApp((s) => s.demoUnlocked);
  const { data: alerts } = useAlerts();
  const open = alerts?.filter((a) => !a.acked).length ?? 0;
  const items = [
    { to: "/", label: "Patient workspace", icon: Users, exact: true },
    { to: "/alerts", label: "Alerts", icon: Bell, badge: open },
    { to: "/cohort", label: "Cohort insights", icon: LineChart },
    { to: "/rig", label: "Check-in studio", icon: Radio },
    ...(unlocked ? [{ to: "/demo", label: "Demo", icon: Gamepad2 }] : []),
  ] as const;
  return (
    <nav aria-label="Main" className="flex flex-col gap-2 px-4 py-5">
      <p className="mb-2 px-4 text-[10px] font-bold uppercase text-muted-foreground">Clinical workspace</p>
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          onClick={onNavigate}
          activeOptions={{ exact: "exact" in it && it.exact }}
          className="group flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:shadow-soft"
        >
          <it.icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          <span className="flex-1">{it.label}</span>
          {"badge" in it && it.badge > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground" aria-label={`${it.badge} open alerts`}>{it.badge}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function Shell() {
  const { data: health } = useHealth();
  const dark = useApp((s) => s.dark);
  const setDark = useApp((s) => s.setDark);
  const setUnlocked = useApp((s) => s.setDemoUnlocked);
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const logout = useLogout();

  useEffect(() => {
    if (path.startsWith("/demo")) localStorage.setItem("unnamed-demo", "1");
    if (localStorage.getItem("unnamed-demo") === "1") setUnlocked(true);
  }, [path, setUnlocked]);

  const mockMode = health?.mode === "mock";
  const section = path.startsWith("/patients/") ? "Patient record" : path.startsWith("/alerts") ? "Alerts" : path.startsWith("/cohort") ? "Cohort insights" : path.startsWith("/rig") ? "Check-in studio" : path.startsWith("/demo") ? "Demo console" : "Patient workspace";

  return (
    <div className="flex min-h-screen overflow-x-clip bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <Nav />
        <div className="mt-auto px-7 pb-7">
          <div className="mb-4 flex items-center gap-2 border-t pt-5 text-xs font-extrabold"><FlaskConical className="h-4 w-4 text-primary" /> Research environment</div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Synthetic patients. Model forecasts support, but never replace, clinical judgment.</p>
          <div className="mt-5 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-lab-lilac text-xs font-extrabold">CL</span><div><p className="text-xs font-bold">Clinical lab</p><p className="text-[10px] text-muted-foreground">TBI recovery research</p></div></div>
        </div>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <Nav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur lg:px-10">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></Button>
          <div className="hidden items-center gap-3 text-xs sm:flex"><span className="text-muted-foreground">Clinical lab</span><ChevronRight className="h-3 w-3 text-muted-foreground" /><span className="font-bold">{section}</span></div>
          <span className="text-sm font-extrabold sm:hidden">synapshot.</span>
          <div className="ml-auto flex items-center gap-2">
            {mockMode && (
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-accent-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Synthetic data</span>
            )}
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {authEnabled && logout && (
              <Button variant="ghost" size="icon" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
            )}
          </div>
        </header>
        <main className={cn("print-page mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-5 py-7 lg:px-10 lg:py-10")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" aria-label="Synapshot home" className="flex h-[100px] items-center gap-3 px-7">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary-soft text-primary"><Brain className="h-6 w-6" strokeWidth={1.5} aria-hidden /></span>
      <span><span className="block text-2xl font-black">synapshot.</span><span className="block text-[10px] font-semibold text-muted-foreground">The brain twin lab</span></span>
    </Link>
  );
}
