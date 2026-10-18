/** Every frequency is a harmonic of the 24-second period: position AND velocity match. */
export const ENVIRONMENT_PERIOD = 24;
const TAU = Math.PI * 2;
export const smooth = (x: number) => {
  const p = Math.max(0, Math.min(1, x));
  return p * p * (3 - 2 * p);
};
export function windAt(seconds: number) {
  const p = (TAU * seconds) / ENVIRONMENT_PERIOD;
  return (
    0.55 * Math.sin(p) +
    0.25 * Math.sin(2 * p - 0.7) +
    0.13 * Math.sin(3 * p + 0.4) +
    0.07 * Math.sin(4 * p - 0.3)
  );
}
export function environmentAt(seconds: number) {
  const wind = windAt(seconds);
  return {
    wind,
    foliage: windAt(seconds - 0.65),
    tips: windAt(seconds - 1.05),
    light: wind * 48,
  };
}
export const LEAF_STARTS = [0.7, 2.4, 4.3, 6, 10.7, 12.4, 14.3, 16];
export const LEAF_DURATION = 7.6;
/** Wind carries staggered leaves completely across the room; resets happen offscreen. */
export function leafAt(seconds: number, index: number) {
  const start = LEAF_STARTS[index % LEAF_STARTS.length];
  const age =
    (((seconds % ENVIRONMENT_PERIOD) + ENVIRONMENT_PERIOD) %
      ENVIRONMENT_PERIOD) -
    start;
  const p = Math.max(0, Math.min(1, age / LEAF_DURATION));
  return {
    x: -64 + 1250 * p,
    y:
      270 +
      (index % 4) * 76 +
      155 * p +
      34 * Math.sin(Math.PI * 2 * p + index * 0.8),
    angle:
      -0.6 + index * 0.7 + p * 3.2 + 0.45 * Math.sin(Math.PI * 4 * p + index),
    opacity:
      age > 0 && age < LEAF_DURATION
        ? 0.8 * smooth(p / 0.08) * smooth((1 - p) / 0.08)
        : 0,
  };
}
