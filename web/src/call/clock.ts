// One clock for the whole call. Frame timestamps, stimulus timestamps and live events all
// come from here, so the backend can line up what the screen drew against what the camera
// saw without guessing an offset.

/** Milliseconds on the page's monotonic clock. */
export function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Clamps a value into a range, used everywhere a measurement feeds a validated field. */
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** A promise that settles after a delay. */
export function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
