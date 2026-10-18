// The clinician routes sit behind the backend's HttpOnly session cookie. The backend decides
// whether a password is needed at all: with AUTH_ENABLED=0 every request is already the demo
// admin, so the gate lets the clinic through. The public sign-in form stays available.
//
// A missing backend is not a lockout either. The app falls back to the seeded mock layer, which
// has no accounts, so mock mode passes straight through.

import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, isMock, useHealth, useSession } from "@/api/client";
import { Loading } from "@/components/common";

export function AuthGate({
  children,
  pending,
}: {
  children: ReactNode;
  pending?: ReactNode;
}) {
  const health = useHealth();
  const session = useSession();
  const { pathname } = useLocation();

  if (session.isPending || health.isPending)
    return pending ?? <Loading label="Checking sign in" />;
  if (session.isSuccess) return <>{children}</>;
  if (isMock()) return <>{children}</>;
  if (health.data?.auth === false) return <>{children}</>;

  // Anything else is a real 401: go to the login screen and remember where they were headed.
  return <Navigate to="/login" replace state={{ from: pathname }} />;
}

/** Sign out: drop the server session, clear the cache and send the clinician to the login page. */
export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api.auth.logout();
    } catch {
      // An expired session is the same outcome as a successful logout.
    }
    qc.clear();
    navigate("/login", { replace: true });
  };
}
