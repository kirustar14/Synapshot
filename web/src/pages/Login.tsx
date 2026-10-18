import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useSession } from "@/api/client";

export default function Login({ active = true }: { active?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const session = useSession(active);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const from = (location.state as { from?: unknown } | null)?.from;
  const destination =
    typeof from === "string" && (from === "/app" || from.startsWith("/app/"))
      ? from
      : "/app";

  useEffect(() => {
    // An auth-disabled backend supplies a synthetic session; keep the public login visible.
    if (active && session.isSuccess && session.data.auth !== false)
      navigate(destination, { replace: true });
  }, [active, session.isSuccess, session.data, destination, navigate]);
  useEffect(() => {
    if (error) errorElement.current?.focus();
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const clinician = await api.auth.login(email.trim(), password);
      qc.setQueryData(["session"], clinician);
      await qc.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
      navigate(destination, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className={`login-copy public-copy ${active ? "is-active" : ""}`}
      aria-hidden={!active}
      inert={!active}
    >
      <section className="login-panel" aria-labelledby="login-title">
        <h1 id="login-title" tabIndex={-1}>
          Welcome back
        </h1>
        <p className="login-description">
          Sign in to access your clinical dashboard.
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          <label className="login-field" htmlFor="clinician-email">
            <span>Email</span>
            <input
              id="clinician-email"
              type="email"
              name="email"
              autoComplete="username"
              placeholder="you@clinic.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          <label className="login-field" htmlFor="clinician-password">
            <span>Password</span>
            <input
              id="clinician-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="login-status" aria-live="polite">
            {error && (
              <p
                id="login-error"
                ref={errorElement}
                tabIndex={-1}
                className="login-error"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
