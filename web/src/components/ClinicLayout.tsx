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
    <Link to="/" aria-label="Synapshot home" className="flex h-[92px] items-center gap-3 px-7">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-soft">
        <Brain className="h-5 w-5" strokeWidth={2} aria-hidden />
      </span>
      <span>
        <span className="block text-xl font-black leading-[22px] tracking-tight">synapshot.</span>
        <span className="block text-xs font-semibold text-muted-foreground">Brain twin lab</span>
      </span>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const unlocked = useApp((s) => s.demoUnlocked);
  const { data: alerts } = useAlerts();
  const open = alerts?.filter((a) => !a.acked).length ?? 0;

  const items: NavItem[] = [
    { to: "/", label: "Patients", icon: Users, end: true },
    { to: "/alerts", label: "Alerts", icon: Bell, badge: open },
    { to: "/cohort", label: "Cohort", icon: LineChart },
    { to: "/rig", label: "Live call", icon: Radio },
  ];
  if (unlocked) items.push({ to: "/demo", label: "Demo", icon: Gamepad2 });

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-4 py-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex h-11 items-center gap-3 rounded-[14px] px-3.5 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              isActive
                ? "bg-sidebar-accent font-extrabold text-sidebar-accent-foreground shadow-soft"
                : "font-bold text-sidebar-foreground hover:bg-sidebar-accent/70",
            )
          }
        >
          <item.icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          <span className="flex-1">{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span
              className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-extrabold text-destructive-foreground"
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
  { prefix: "/patients/", label: "Patient" },
  { prefix: "/alerts", label: "Alerts" },
  { prefix: "/cohort", label: "Cohort" },
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

  const section = SECTIONS.find((s) => pathname.startsWith(s.prefix))?.label ?? "Patients";
  const syntheticData = health?.mode === "mock";
  const mockLayer = isMock();

  return (
    <div className="flex min-h-screen overflow-x-clip bg-background">
      <aside className="no-print sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-sidebar lg:flex">
        <Brand />
        <Nav />
        <div className="mt-auto px-4 pb-6">
          <div className="rounded-2xl bg-card/70 p-4">
            <div className="flex items-center gap-2 text-[13px] font-extrabold">
              <FlaskConical className="h-4 w-4 text-synthetic" aria-hidden /> Research use only
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Synthetic patients. Forecasts support clinical judgment and never replace it.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3 px-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-xs font-extrabold shadow-soft">CL</span>
            <div>
              <p className="text-[13px] font-bold">Clinical lab</p>
              <p className="text-xs text-muted-foreground">TBI recovery research</p>
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
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 bg-background/85 px-4 backdrop-blur-md lg:pl-6 lg:pr-12">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <div className="hidden items-center gap-2 text-[13px] font-semibold sm:flex">
            <span className="text-muted-foreground">Clinical lab</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-bold">{section}</span>
          </div>
          <span className="text-sm font-extrabold sm:hidden">synapshot.</span>
          <div className="ml-auto flex items-center gap-2">
            {syntheticData && (
              <span className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs font-bold text-muted-foreground shadow-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-synthetic" aria-hidden />
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
        <main className="print-page mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-5 pb-12 pt-4 lg:pl-6 lg:pr-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
