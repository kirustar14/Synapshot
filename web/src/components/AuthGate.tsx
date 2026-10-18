// Optional Auth0 login over the clinician routes. With neither env var set there is no
// login at all and nothing in the tree changes, which is how the demo runs.

import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/common";

const DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const CLIENT = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;

/** True only when both Auth0 variables are set. Everything else keys off this. */
export const authEnabled = Boolean(DOMAIN && CLIENT);

function SignIn() {
  const { loginWithRedirect, error } = useAuth0();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="panel w-full max-w-sm p-8 text-center">
        <p className="text-2xl font-black">unnamed.</p>
        <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
          The brain twin lab
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Clinician sign in required.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error.message}
          </p>
        )}
        <Button className="mt-6 w-full" onClick={() => loginWithRedirect()}>
          Sign in
        </Button>
        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Patient pages do not need an account. Only the clinician dashboard is behind
          this.
        </p>
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth0();
  if (isLoading) return <Loading label="Checking sign in" />;
  if (!isAuthenticated) return <SignIn />;
  return <>{children}</>;
}

/** Wraps the clinician routes in Auth0, or passes them straight through when it is off. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!authEnabled) return <>{children}</>;
  return (
    <Auth0Provider
      domain={DOMAIN as string}
      clientId={CLIENT as string}
      authorizationParams={{ redirect_uri: window.location.origin }}
    >
      <Gate>{children}</Gate>
    </Auth0Provider>
  );
}

/** The logout function when Auth0 is on, else null. Only valid inside AuthGate. */
export function useLogout() {
  if (!authEnabled) return null;
  // Safe: authEnabled is read from import.meta.env, so it cannot change between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth0().logout;
}
