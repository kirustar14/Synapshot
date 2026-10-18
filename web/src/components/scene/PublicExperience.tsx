import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import LayeredScene from "./LayeredScene";
import "@/pages/landing.css";

/** The public route owns the environment; content stays mounted for the crossfade. */
export default function PublicExperience() {
  const location = useLocation();
  const login = location.pathname === "/login";
  const initial = useRef(true);
  useEffect(() => {
    document.title = login
      ? "Clinician sign in · Synapshot"
      : "Synapshot · Ongoing insight for recovering minds";
    if (initial.current) {
      initial.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    const timer = window.setTimeout(
      () =>
        document
          .getElementById(login ? "login-title" : "lp-title")
          ?.focus({ preventScroll: true }),
      550,
    );
    return () => clearTimeout(timer);
  }, [login]);
  return (
    <LayeredScene variant={login ? "login" : "landing"}>
      <a href={login ? "#login-title" : "#lp-title"} className="public-skip">
        Skip to content
      </a>
      <header className="lp-nav">
        <Link to="/" className="lp-mark" aria-label="Synapshot home">
          <BrandMark className="lp-mark-art" />
          <span>synapshot</span>
        </Link>
        {!login && (
          <nav aria-label="Public navigation">
            <Link to="/login" className="lp-login">
              Login
            </Link>
          </nav>
        )}
      </header>
      <Landing active={!login} />
      <Login active={login} />
    </LayeredScene>
  );
}
