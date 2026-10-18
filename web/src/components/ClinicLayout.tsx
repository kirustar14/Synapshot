// The authenticated clinician shell. A compact, deliberately collapsible rail on the left, a
// restrained header with patient search and the account avatar, and one mounted Outlet. The
// rail never expands on hover; only the toggle changes its width.
//
// The dashboard palette is scoped to html.dash while this shell is mounted, so the landing and
// login screens keep their own tokens.

import "@/dashboard/theme.css";

import {
  ClipboardCheck,
  FileText,
  FlaskConical,
  House,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { usePatients, useSession } from "@/api/client";
import { useSignOut } from "@/components/AuthGate";
import { BrandMark } from "@/components/BrandMark";
import { RouteSurface } from "@/components/RouteSurface";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { initialsOf } from "@/dashboard/derive";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/app", label: "Overview", icon: House, end: true },
  { to: "/app/patients", label: "Patients", icon: Users },
  { to: "/app/assessments", label: "Assessments", icon: ClipboardCheck },
  { to: "/app/research", label: "Research", icon: FlaskConical },
  { to: "/app/reports", label: "Reports", icon: FileText },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon },
];

const RAIL_KEY = "synapshot-rail";

function readCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(RAIL_KEY);
    if (raw === "collapsed") return true;
    if (raw === "expanded") return false;
  } catch {
    // Storage can be blocked; the rail simply starts expanded.
  }
  return false;
}

function Wordmark({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      to="/app"
      aria-label="Synapshot overview"
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-[#e8e2d8] text-[#1c1a17]",
        collapsed ? "justify-center px-0" : "px-5",
      )}
    >
      {collapsed ? (
        // Collapsed, the mark carries the wordmark on its own, so the rail still reads as the
        // product rather than as a stray letter.
        <BrandMark className="h-[19px] w-[19px]" />
      ) : (
        <span className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[17px] font-semibold tracking-[-0.035em]">synapshot</span>
        </span>
      )}
    </Link>
  );
}

function NavLinkRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex h-9 items-center rounded-[7px] text-[13px] transition-colors",
          collapsed ? "mx-auto w-10 justify-center" : "mx-2 gap-2.5 px-2.5",
          isActive
            ? "bg-[#fbeade] font-medium text-[#8a4222]"
            : "font-normal text-[#55504a] hover:bg-[#ece6db] hover:text-[#1c1a17]",
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            className={cn("h-[16px] w-[16px] shrink-0", isActive ? "text-[#a8492a]" : "text-[#7d766b]")}
            strokeWidth={1.7}
            aria-hidden
          />
          {!collapsed && <span className="truncate">{item.label}</span>}
          {collapsed && <span className="sr-only">{item.label}</span>}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function Rail({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f2eee6]">
      {onToggle && <Wordmark collapsed={collapsed} />}
      <TooltipProvider delayDuration={200}>
        <nav aria-label="Main" className="flex flex-col gap-0.5 py-3">
          {NAV.map((item) => (
            <NavLinkRow key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </nav>
      </TooltipProvider>

      <div className="mt-auto border-t border-[#e8e2d8] p-2">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "flex h-9 w-full items-center rounded-[7px] text-[12px] text-[#6d675e] transition-colors hover:bg-[#e8e2d7] hover:text-[#1c1a17]",
              collapsed ? "justify-center" : "gap-2 px-2.5",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[16px] w-[16px]" strokeWidth={1.7} aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="h-[16px] w-[16px]" strokeWidth={1.7} aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Header patient search. Results are links, so tab and enter work without extra bindings. */
function PatientSearch() {
  const { data } = usePatients();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (data ?? [])
      .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .slice(0, 6);
  }, [data, query]);

  return (
    <div
      ref={wrap}
      className="relative w-full max-w-[520px]"
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="patient-search" className="sr-only">
        Search patients
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#8b8375]"
        strokeWidth={1.8}
        aria-hidden
      />
      <input
        id="patient-search"
        type="search"
        autoComplete="off"
        value={query}
        placeholder="Search patients, check-ins, or notes"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            navigate(`/app/patients/${results[0].id}`);
            setQuery("");
            setOpen(false);
          }
        }}
        className="h-9 w-full rounded-[8px] border border-[#e6e0d6] bg-[#fbf9f4] pl-9 pr-8 text-[13px] text-[#1c1a17] outline-none transition-colors placeholder:text-[#9b9488] focus:border-[#c9c0b1] focus:bg-[#fffdfa]"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setOpen(false);
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#8b8375] hover:text-[#1c1a17]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}

      {open && query.trim() && (
        <div
          role="region"
          aria-label="Patient search results"
          className="absolute left-0 right-0 top-[42px] z-40 overflow-hidden rounded-[9px] border border-[#e3ddd2] bg-[#fffdfa] shadow-[0_18px_40px_-24px_rgba(28,26,23,0.35)]"
        >
          <p className="border-b border-[#f0eae1] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b8375]">
            Patients
          </p>
          {results.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[#6d675e]">
              No patient matches “{query.trim()}”. Search uses the display name.
            </p>
          ) : (
            <ul>
              {results.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/app/patients/${p.id}`}
                    onClick={() => {
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] hover:bg-[#f7f2ea] focus:bg-[#f7f2ea]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f1ece3] text-[10px] font-medium text-[#6b5a45]">
                        {initialsOf(p.name)}
                      </span>
                      <span className="truncate font-medium">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-[#8b8375]">Week {p.week}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const { data } = useSession();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  const name = data?.name ?? "Demo clinician";
  const email = data?.email ?? "demo@synapshot.health";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e3dcd0] bg-[#f6f1e8] text-[11px] font-semibold text-[#6b5a45] transition-colors hover:bg-[#efe8db]"
        >
          {initialsOf(name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-[9px] border-[#e3ddd2] bg-[#fffdfa] p-1">
        <DropdownMenuLabel className="px-2 py-2">
          <span className="block text-[13px] font-medium text-[#1c1a17]">{name}</span>
          <span className="block truncate text-[11px] font-normal text-[#8b8375]">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#f0eae1]" />
        <DropdownMenuItem asChild className="rounded-[6px] text-[13px] focus:bg-[#f7f2ea]">
          <Link to="/app/settings#profile">
            <UserRound className="text-[#7d766b]" aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-[6px] text-[13px] focus:bg-[#f7f2ea]">
          <Link to="/app/settings">
            <SlidersHorizontal className="text-[#7d766b]" aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#f0eae1]" />
        <DropdownMenuItem
          className="rounded-[6px] text-[13px] text-[#96311f] focus:bg-[#f8e6e2] focus:text-[#96311f]"
          disabled={signingOut}
          onSelect={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden /> {signingOut ? "Signing out" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ClinicLayout({ pending = false }: { pending?: boolean }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileNav, setMobileNav] = useState(false);
  const { pathname } = useLocation();

  // Applied before paint so the dashboard never flashes the public palette. Radix portals sit
  // on body, so the tokens have to live on the document element rather than a wrapper.
  useLayoutEffect(() => {
    document.documentElement.classList.add("dash");
    return () => document.documentElement.classList.remove("dash");
  }, []);

  useEffect(() => {
    setMobileNav(false);
  }, [pathname]);

  const toggle = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? "expanded" : "collapsed");
      } catch {
        // Storage can be blocked; the rail still works for this session.
      }
      return !v;
    });
  };

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#1c1a17]">
      <a
        href="#clinic-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[#fffdfa] focus:px-3 focus:py-2 focus:text-[13px] focus:shadow"
      >
        Skip to content
      </a>

      <div className="flex min-h-screen">
        <aside
          className={cn(
            "dash-rail sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[#e8e2d8] lg:flex",
            collapsed ? "w-16" : "w-[216px]",
          )}
        >
          <Rail collapsed={collapsed} onToggle={toggle} />
        </aside>

        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="w-[248px] border-r border-[#e8e2d8] bg-[#f2eee6] p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Rail collapsed={false} onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[#e8e2d8] bg-[#f7f5f0]/92 px-4 backdrop-blur-md lg:px-6">
            <button
              type="button"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[#55504a] hover:bg-[#ece6db] lg:hidden"
            >
              <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
            </button>
            {/* Below lg the rail is behind the menu button, so this header carries the brand.
                It gets the mark too, or the narrow window is the one place the logo is missing. */}
            <Link
              to="/app"
              className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.03em] lg:hidden"
            >
              <BrandMark className="h-[15px] w-[15px]" />
              synapshot
            </Link>

            <div className="hidden flex-1 justify-center px-2 md:flex">
              <PatientSearch />
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span
                className="hidden items-center gap-1.5 text-[11px] text-[#8b8375] xl:flex"
                title="All records in this workspace are synthetic. The models are experimental."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#a9762b]" aria-hidden />
                Synthetic cohort
              </span>
              <AccountMenu />
            </div>
          </header>

          <main id="clinic-main" className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">
            <div className="mx-auto w-full max-w-[1480px]">
              <RouteSurface>
                {pending ? <WorkspaceSkeleton label="Checking sign in" /> : <Outlet />}
              </RouteSurface>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
