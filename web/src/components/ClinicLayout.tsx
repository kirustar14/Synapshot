// The clinician shell: sticky sidebar, 76px top bar, and the research environment footer.
// The patient facing routes do not use this shell.

import { Bell, Brain, ChevronRight, FlaskConical, Gamepad2, LineChart, LogOut, Menu, Moon, Radio, Sun, Users } from "lucide-react";
import { authEnabled, useLogout } from "@/components/AuthGate";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { isMock, useAlerts, useHealth } from "@/api/client";
import { SyntheticBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  end?: boolean;
  badge?: number;
}

function Brand() {
  return (
    <Link to="/" aria-label="Synapshot home" className="flex h-[100px] items-center gap-3 px-7">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary-soft text-primary">
        <Brain className="h-6 w-6" strokeWidth={1.5} aria-hidden />
      </span>
      <span>
        <span className="block text-2xl font-black">synapshot.</span>
        <span className="block text-[10px] font-semibold text-muted-foreground">The brain twin lab</span>
      </span>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const unlocked = useApp((s) => s.demoUnlocked);
  const { data: alerts } = useAlerts();
  const open = alerts?.filter((a) => !a.acked).length ?? 0;

  const items: NavItem[] = [
    { to: "/", label: "Patient workspace", icon: Users, end: true },
    { to: "/alerts", label: "Alerts", icon: Bell, badge: open },
    { to: "/cohort", label: "Cohort insights", icon: LineChart },
    { to: "/rig", label: "Live call", icon: Radio },
  ];
  if (unlocked) items.push({ to: "/demo", label: "Demo", icon: Gamepad2 });

  return (
    <nav aria-label="Main" className="flex flex-col gap-2 px-4 py-5">
      <p className="mb-2 px-4 text-[10px] font-bold uppercase text-muted-foreground">Clinical workspace</p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-soft"
                : "text-sidebar-foreground hover:bg-sidebar-accent",
            )
          }
        >
          <item.icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          <span className="flex-1">{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span
              className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground"
              aria-label={`${item.badge} open alerts`}
            >
              {item.badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

const SECTIONS: { prefix: string; label: string }[] = [
  { prefix: "/patients/", label: "Patient record" },
  { prefix: "/alerts", label: "Alerts" },
  { prefix: "/cohort", label: "Cohort insights" },
  { prefix: "/rig", label: "Live call" },
  { prefix: "/demo", label: "Demo console" },
];

export function ClinicLayout() {
  const { data: health } = useHealth();
  const dark = useApp((s) => s.dark);
  const setDark = useApp((s) => s.setDark);
  const logout = useLogout();
  const setUnlocked = useApp((s) => s.setDemoUnlocked);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname.startsWith("/demo")) setUnlocked(true);
  }, [pathname, setUnlocked]);

  const section = SECTIONS.find((s) => pathname.startsWith(s.prefix))?.label ?? "Patient workspace";
  const syntheticData = health?.mode === "mock";
  const mockLayer = isMock();

  return (
    <div className="flex min-h-screen overflow-x-clip bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <Nav />
        <div className="mt-auto px-7 pb-7">
          <div className="mb-4 flex items-center gap-2 border-t pt-5 text-xs font-extrabold">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden /> Research environment
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Synthetic patients. Model forecasts support, but never replace, clinical judgment.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lab-lilac text-xs font-extrabold">CL</span>
            <div>
              <p className="text-xs font-bold">Clinical lab</p>
              <p className="text-[10px] text-muted-foreground">TBI recovery research</p>
            </div>
          </div>
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
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <div className="hidden items-center gap-3 text-xs sm:flex">
            <span className="text-muted-foreground">Clinical lab</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span className="font-bold">{section}</span>
          </div>
          <span className="text-sm font-extrabold sm:hidden">synapshot.</span>
          <div className="ml-auto flex items-center gap-2">
            {syntheticData && (
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-accent-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                Synthetic data
              </span>
            )}
            {mockLayer && <SyntheticBadge className="px-3 py-1.5 font-bold" label="Mock data" />}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDark(!dark)}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </Button>
            {authEnabled && logout && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </header>
        <main className="print-page mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-5 py-7 lg:px-10 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
