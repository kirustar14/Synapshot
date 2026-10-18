import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "./common";

const DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const CLIENT = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
export const authEnabled = !!(DOMAIN && CLIENT);

function Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, error } = useAuth0();
  if (isLoading) return <Loading label="Checking sign in" />;
  if (!isAuthenticated)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="panel w-full max-w-sm p-8 text-center">
          <p className="text-lg font-semibold tracking-tight">Synapshot</p>
          <p className="mt-2 text-sm text-muted-foreground">Clinician sign in required.</p>
          {error && <p className="mt-2 text-sm text-destructive">{error.message}</p>}
          <Button className="mt-6 w-full" onClick={() => loginWithRedirect()}>Sign in</Button>
        </div>
      </div>
    );
  return <>{children}</>;
}

/** Wraps clinician routes in Auth0 only when both env vars are set. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!authEnabled) return <>{children}</>;
  return (
    <Auth0Provider domain={DOMAIN!} clientId={CLIENT!} authorizationParams={{ redirect_uri: window.location.origin }}>
      <Gate>{children}</Gate>
    </Auth0Provider>
  );
}

export function useLogout() {
  // only valid inside AuthGate when enabled
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return authEnabled ? useAuth0().logout : null;
}
