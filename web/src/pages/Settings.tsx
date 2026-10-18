// Settings keeps the workspace honest: who is signed in, which environment is being used,
// and which capabilities are still waiting on a backend. There is no role switcher because the
// product has no role switching.

import { ArrowUpRight, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { isMock, useHealth, useSession } from "@/api/client";
import { useSignOut } from "@/components/AuthGate";
import { SectionCard } from "@/dashboard/components";
import { initialsOf } from "@/dashboard/derive";

export default function Settings() {
  const session = useSession();
  const health = useHealth();
  const signOut = useSignOut();
  const name = session.data?.name ?? "Demo clinician";
  const clinician = session.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Settings</h1>
        <p className="mt-1 text-[13px] text-[#6d675e]">Account, workspace environment and prototype status.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Profile" subtitle="Who is signed in to this workspace." className="scroll-mt-20" >
          <div id="profile" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e3dcd0] bg-[#f6f1e8] text-[12px] font-semibold text-[#6b5a45]">
              {initialsOf(name)}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{name}</p>
              <p className="truncate text-[11px] text-[#8b8375]">{clinician?.email ?? "demo@synapshot.health"}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[10px] text-[#8b8375]">Role</dt>
              <dd className="mt-0.5 text-[12px]">{clinician?.role ?? "clinician"}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-[#8b8375]">Clinic</dt>
              <dd className="mt-0.5 truncate text-[12px]">{clinician?.clinic_name ?? "Synapshot demo clinic"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[10px] leading-relaxed text-[#8b8375]">
            Roles are fixed by the session. There is no role switching in this prototype, and the account menu does
            not pretend otherwise.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e6e0d6] bg-[#fffdfa] px-2.5 text-[11px] text-[#96311f] hover:bg-[#fbf0ec]"
          >
            <LogOut className="h-3 w-3" aria-hidden /> Sign out
          </button>
        </SectionCard>

        <SectionCard title="Environment" subtitle="What this deployment is reading and writing.">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[10px] text-[#8b8375]">Data mode</dt>
              <dd className="mt-0.5 text-[12px]">{health.data?.mode ?? "unknown"}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-[#8b8375]">Client fallback</dt>
              <dd className="mt-0.5 text-[12px]">{isMock() ? "local mock layer" : "backend"}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-[#8b8375]">Database</dt>
              <dd className="mt-0.5 text-[12px]">{health.data?.db ?? "not reported"}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-[#8b8375]">Sign-in gate</dt>
              <dd className="mt-0.5 text-[12px]">{health.data?.auth === false ? "disabled for demo" : "session required"}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-[7px] border border-[#f0e0cd] bg-[#fbf4e9] px-3 py-2 text-[10px] leading-relaxed text-[#7a5410]">
            Every patient record in this workspace is synthetic. Model forecasts are experimental research output, not
            a diagnosis or a treatment recommendation.
          </div>
        </SectionCard>

        <SectionCard title="Prototype tools" subtitle="Existing capabilities kept reachable outside the primary navigation.">
          <ul className="divide-y divide-[#f1ece4]">
            {[
              { to: "/app/alerts", label: "Alerts", detail: "Every open and acknowledged monitoring flag" },
              { to: "/app/rig", label: "Live check-in rig", detail: "The browser capture pipeline and preflight checks" },
              { to: "/app/demo", label: "Demo console", detail: "Advance a week, inject drift, trigger a call" },
              { to: "/app/research", label: "Research", detail: "Cohort calibration and parameter recovery" },
            ].map((t) => (
              <li key={t.to}>
                <Link to={t.to} className="flex items-center gap-3 py-2.5 hover:text-[#8a4222]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium">{t.label}</span>
                    <span className="block text-[10px] text-[#8b8375]">{t.detail}</span>
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[#a49c8f]" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Data handling and limits" subtitle="What is stored, and where.">
          <ul className="space-y-2 text-[11px] leading-relaxed text-[#6d675e]">
            <li>
              <span className="font-medium text-[#55504a]">Clinical notes</span> are kept in this browser's local
              storage and each saved note is written to the patient record. The contract does not serve a note list
              back yet.
            </li>
            <li>
              <span className="font-medium text-[#55504a]">Video and audio</span> are not retained for check-ins. The
              assessment screens say so instead of showing a placeholder player.
            </li>
            <li>
              <span className="font-medium text-[#55504a]">Report history</span> is not stored. Reports are printable
              previews built from the current record.
            </li>
            <li>
              <span className="font-medium text-[#55504a]">Accessibility</span>: reduced motion is respected by the
              shell and route transitions. Keyboard focus is visible on every control.
            </li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
