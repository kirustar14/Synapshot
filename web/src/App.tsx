// Router, query client, theme sync and the toaster. The landing page and the login screen are
// public; the clinician workspace lives under /app behind the session gate. Patient facing
// call links stay public because they open from a text message.
//
// Authenticated shape: Overview, Patients, Assessments, Research, Reports and Settings are the
// primary destinations. Document intake and the consolidated brain workspace also have
// dedicated routes behind the same session gate.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, RouterProvider } from "react-router-dom";
import { createRouter } from "@/lib/sentry";
import { AuthGate } from "@/components/AuthGate";
import { ClinicLayout } from "@/components/ClinicLayout";
import { WorkspaceLayout } from "@/components/WorkspaceLayout";
import Clinic from "@/pages/Clinic";
import PatientNew from "@/pages/PatientNew";
import Workspace from "@/pages/Workspace";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/store/app";
import Alerts from "@/pages/Alerts";
import Assessments from "@/pages/Assessments";
import Overview from "@/pages/Overview";
import PublicExperience from "@/components/scene/PublicExperience";
import NotFound from "@/pages/NotFound";
import PatientAssessment from "@/pages/PatientAssessment";
import PatientAssessments from "@/pages/PatientAssessments";
import PatientCall from "@/pages/PatientCall";
import PatientLayout from "@/pages/PatientLayout";
import PatientNotes from "@/pages/PatientNotes";
import PatientOverview from "@/pages/PatientOverview";
import PatientRecovery from "@/pages/PatientRecovery";
import PatientReports from "@/pages/PatientReports";
import PatientsPage from "@/pages/PatientsPage";
import Reports from "@/pages/Reports";
import Research from "@/pages/Research";
import Settings from "@/pages/Settings";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

export const routes = [
  {
    element: <PublicExperience />,
    children: [{ path: "/", element: <></> }, { path: "/login", element: <></> }],
  },
  {
    // Only the clinician routes sit behind the session. The patient pages must open from a
    // texted link with no account, so they stay outside it.
    element: (
      <AuthGate pending={<ClinicLayout pending />}>
        <ClinicLayout />
      </AuthGate>
    ),
    children: [
      { path: "/app", element: <Overview /> },
      { path: "/app/patients", element: <PatientsPage /> },
      { path: "/app/assessments", element: <Assessments /> },
      { path: "/app/research", element: <Research /> },
      { path: "/app/reports", element: <Reports /> },
      { path: "/app/settings", element: <Settings /> },
      {
        path: "/app/patients/:id",
        element: <PatientLayout />,
        children: [
          { index: true, element: <PatientOverview /> },
          { path: "assessments", element: <PatientAssessments /> },
          { path: "assessments/:cid", element: <PatientAssessment /> },
          { path: "recovery", element: <PatientRecovery /> },
          { path: "notes", element: <PatientNotes /> },
          { path: "reports", element: <PatientReports /> },
          // Kept as redirects so old links and bookmarks land on the new tabs.
          { path: "twin", element: <Navigate to="../recovery" replace /> },
          { path: "calls", element: <Navigate to="../assessments" replace /> },
          { path: "upload", element: <PatientRecovery /> },
          { path: "compare", element: <PatientRecovery /> },
        ],
      },
      { path: "/app/alerts", element: <Alerts /> },
      { path: "/app/cohort", element: <Navigate to="/app/research" replace /> },
      { path: "/app/rig", element: <Navigate to="/clinic" replace /> },
      { path: "/app/rig/preflight", element: <Navigate to="/clinic" replace /> },
      { path: "/app/demo", element: <Navigate to="/clinic" replace /> },
      { path: "/app/*", element: <Navigate to="/app" replace /> },
    ],
  },
  {
    element: <AuthGate><WorkspaceLayout /></AuthGate>,
    children: [
      { path: "/clinic", element: <Clinic /> },
      { path: "/patients/new", element: <PatientNew /> },
      { path: "/patients/:id", element: <Workspace /> },
    ],
  },
  { path: "/call/:token", element: <PatientCall /> },
  { path: "*", element: <NotFound /> },
];

const router = createRouter(routes);

/** Keeps the .dark class on html in step with the store, which persists it to localStorage. */
function ThemeSync() {
  const dark = useApp((s) => s.dark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
