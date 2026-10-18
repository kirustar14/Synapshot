// Keeping the phone usable for fourteen minutes: screen awake, no pinch zoom, no scroll
// bounce, no accidental text selection in the middle of a timed trial.
//
// Every function returns its own undo, so the call page can put the phone back the way it
// found it when the patient leaves.

interface Sentinel {
  release: () => Promise<void>;
  addEventListener: (type: string, fn: () => void) => void;
}

interface WakeLock {
  request: (type: "screen") => Promise<Sentinel>;
}

/** Asks for a screen wake lock and re-takes it when the tab comes back. */
export function keepAwake(): () => void {
  const lock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (!lock) return () => {};
  let held: Sentinel | null = null;
  let live = true;
  const take = () => {
    if (!live || document.visibilityState !== "visible") return;
    lock
      .request("screen")
      .then((sentinel) => {
        held = sentinel;
        sentinel.addEventListener("release", () => {
          held = null;
        });
      })
      .catch(() => {});
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && !held) take();
  };
  take();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    live = false;
    document.removeEventListener("visibilitychange", onVisible);
    void held?.release().catch(() => {});
    held = null;
  };
}

/** Locks the viewport: no pinch zoom, no double tap zoom, no rubber banding.
 *
 * Scrolling itself stays on, because a consent paragraph that cannot be scrolled is a
 * consent paragraph nobody read. What is locked is the gestures that move the page out
 * from under a timed trial.
 */
export function lockViewport(): () => void {
  const meta = document.querySelector('meta[name="viewport"]');
  const before = meta?.getAttribute("content") ?? "";
  meta?.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
  const body = document.body.style;
  const root = document.documentElement.style;
  const keep = { touch: body.touchAction, over: root.overscrollBehavior, select: body.userSelect };
  body.touchAction = "pan-y";
  body.userSelect = "none";
  root.overscrollBehavior = "none";
  const block = (ev: Event) => ev.preventDefault();
  document.addEventListener("gesturestart", block);
  return () => {
    if (meta && before) meta.setAttribute("content", before);
    body.touchAction = keep.touch;
    body.userSelect = keep.select;
    root.overscrollBehavior = keep.over;
    document.removeEventListener("gesturestart", block);
  };
}

/** Scales every rem in the page, which is how the large text option works. */
export function setTextScale(big: boolean): void {
  document.documentElement.style.fontSize = big ? "19px" : "";
}
