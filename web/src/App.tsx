// Router, query client, theme sync and the toaster. The clinic routes sit inside the sidebar
// shell. The patient facing routes sit outside it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { createRouter } from "@/lib/sentry";
import { AuthGate } from "@/components/AuthGate";
import { ClinicLayout } from "@/components/ClinicLayout";
import { Toaster } from "@/components/ui/sonner";
import { useApp } from "@/store/app";
import Alerts from "@/pages/Alerts";
import Cohort from "@/pages/Cohort";
import Consent from "@/pages/Consent";
import Demo from "@/pages/Demo";
import NotFound from "@/pages/NotFound";
import PatientCall from "@/pages/PatientCall";
import PatientCalls from "@/pages/PatientCalls";
import PatientCompare from "@/pages/PatientCompare";
import PatientLayout from "@/pages/PatientLayout";
import PatientOverview from "@/pages/PatientOverview";
import PatientTwin from "@/pages/PatientTwin";
import PatientUpload from "@/pages/PatientUpload";
import Patients from "@/pages/Patients";
import Phone from "@/pages/Phone";
import Rig from "@/pages/Rig";
import RigPreflight from "@/pages/RigPreflight";
import Stretch from "@/pages/Stretch";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

export const routes = [
  {
    // Only the clinician routes sit behind the optional login. The patient pages must
    // open from a texted link with no account, so they stay outside it.
    element: (
      <AuthGate>
        <ClinicLayout />
      </AuthGate>
    ),
    children: [
      { path: "/", element: <Patients /> },
      {
        path: "/patients/:id",
        element: <PatientLayout />,
        children: [
          { index: true, element: <PatientOverview /> },
          { path: "upload", element: <PatientUpload /> },
          { path: "twin", element: <PatientTwin /> },
          { path: "compare", element: <PatientCompare /> },
          { path: "calls", element: <PatientCalls /> },
        ],
      },
      { path: "/alerts", element: <Alerts /> },
      { path: "/cohort", element: <Cohort /> },
      { path: "/rig", element: <Rig /> },
      { path: "/rig/preflight", element: <RigPreflight /> },
      { path: "/demo", element: <Demo /> },
    ],
  },
  { path: "/consent/:token", element: <Consent /> },
  { path: "/phone/:id", element: <Phone /> },
  { path: "/stretch/:token", element: <Stretch /> },
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
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
