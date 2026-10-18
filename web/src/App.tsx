// Router, query client, theme sync and the toaster.
//
// Five routes, which is the whole app:
//
//   /                 the landing page
//   /clinic           one table of everybody
//   /patients/new     build a patient from their documents
//   /patients/:id     the workspace, where everything about one patient lives
//   /call/:token      what the patient opens on their own phone
//
// The clinic routes sit inside the shell. The landing page and the call page do not:
// the landing page is its own full-bleed thing, and the call page has to open from a
// texted link with no account and no clinician chrome anywhere near it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { createRouter } from "@/lib/sentry";
import { AuthGate } from "@/components/AuthGate";
import { ClinicLayout } from "@/components/ClinicLayout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/store/app";
import Clinic from "@/pages/Clinic";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import PatientCall from "@/pages/PatientCall";
import PatientNew from "@/pages/PatientNew";
import Workspace from "@/pages/Workspace";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

export const routes = [
  { path: "/", element: <Home /> },
  {
    // Only the clinician routes sit behind the optional login. The patient page must
    // open from a texted link with no account, so it stays outside it.
    element: (
      <AuthGate>
        <ClinicLayout />
      </AuthGate>
    ),
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
