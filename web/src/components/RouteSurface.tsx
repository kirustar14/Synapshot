import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/** The app shell stays mounted. Only its content receives a short route entrance. */
export function RouteSurface({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !root.current?.animate
    )
      return;
    const animation = root.current.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "cubic-bezier(.2,.6,.35,1)" },
    );
    return () => animation.cancel();
  }, [pathname]);
  return (
    <div ref={root} className="clinic-route-surface">
      {children}
    </div>
  );
}
