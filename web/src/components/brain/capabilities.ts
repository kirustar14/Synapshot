// Can this browser run the viewer at all. Checked before the Canvas mounts so a failure is a
// readable message and a 2D map rather than a blank black rectangle.

export interface Caps {
  webgl: boolean;
  /** Float textures, which the per region value lookup needs. */
  floatTex: boolean;
  reason: string;
}

let cached: Caps | null = null;

/** Probes a throwaway context once per page load. */
export function detectCaps(): Caps {
  if (cached) return cached;
  if (typeof document === "undefined") {
    cached = { webgl: false, floatTex: false, reason: "No document to create a canvas in." };
    return cached;
  }
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const gl2 = canvas.getContext("webgl2");
    if (gl2) {
      cached = { webgl: true, floatTex: true, reason: "" };
      return cached;
    }
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) {
      cached = { webgl: false, floatTex: false, reason: "This browser did not give the page a WebGL context." };
      return cached;
    }
    const float = !!gl.getExtension("OES_texture_float");
    cached = {
      webgl: true,
      floatTex: float,
      reason: float ? "" : "This browser has WebGL 1 without float textures, which the region colour lookup needs.",
    };
    return cached;
  } catch (err) {
    cached = { webgl: false, floatTex: false, reason: err instanceof Error ? err.message : "WebGL probe failed." };
    return cached;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
  }
}
