// MediaPipe Face Landmarker, running on the patient's own phone.
//
// This is the only module that ever touches camera pixels, and nothing it produces is an
// image. One FrameRec per video frame leaves here: iris position as a fraction of the eye
// opening, iris diameter in pixels, head pose, eye openness, mean brightness of the face
// region and three blendshapes. No frame, no thumbnail, no video.
//
// `ratio` is the measurement the backend calibrates on, so both eyes are measured left to
// right in image coordinates and then averaged. `bright` is read off real pixels on a tiny
// offscreen canvas because the camera latency estimate is built from it: the ten white
// flashes in the quality step have to show up as a brightness rise in these numbers.
//
// The wasm runtime is bundled from node_modules rather than fetched from a CDN, so the call
// page works on a phone behind a tunnel with no third party requests. The model file itself
// comes from /models/face_landmarker.task, which `make models` downloads. When it is not
// there the tracker reports why and the call falls back to the speech tasks only.

import type { FaceLandmarker, FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import loaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import binaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { FrameRec } from "@/api/types";
import { clamp, now } from "./clock";
import type { Lights, Point } from "./types";
import { NO_LIGHTS } from "./types";

export const MODEL_PATH = "/models/face_landmarker.task";

// Indices into the 478 point mesh with iris refinement. The first entry of each iris ring
// is its centre. Both eyes are described left to right in image coordinates so the two
// horizontal ratios point the same way and can be averaged.
const IRIS_A = [468, 469, 470, 471, 472];
const IRIS_B = [473, 474, 475, 476, 477];
const EYE_A = { left: 33, right: 133, upper: 159, lower: 145 };
const EYE_B = { left: 362, right: 263, upper: 386, lower: 374 };
// Top, bottom and both sides of the face oval, used for the brightness window.
const FACE_BOX = [10, 152, 234, 454];

const SMALL = 24;
const MIN_IRIS_PX = 8;
const MAX_IRIS_PX = 30;
const MIN_BRIGHT = 0.16;
const MAX_BRIGHT = 0.95;
const STEADY_DEG = 7;
const POSE_WINDOW = 24;
const FPS_WINDOW = 45;

type Marks = NormalizedLandmark[];
type Fileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];

interface EyeRead {
  h: number;
  v: number;
  x: number;
  y: number;
  px: number;
  ear: number;
}

/** Head rotation in degrees out of the 4x4 transform MediaPipe returns. */
function pose(matrix: { data: number[] } | undefined): FrameRec["head"] {
  const m = matrix?.data;
  if (!m || m.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const at = (row: number, col: number) => m[col * 4 + row];
  const deg = 180 / Math.PI;
  return {
    yaw: clamp(Math.atan2(at(0, 2), at(2, 2)) * deg, -90, 90),
    pitch: clamp(Math.asin(clamp(-at(1, 2), -1, 1)) * deg, -90, 90),
    roll: clamp(Math.atan2(at(1, 0), at(1, 1)) * deg, -90, 90),
  };
}

/** The three blendshapes the expression traces read, averaged over left and right. */
function shapes(res: FaceLandmarkerResult): FrameRec["blend"] {
  const cats = res.faceBlendshapes?.[0]?.categories ?? [];
  const score = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
  return {
    smile: clamp((score("mouthSmileLeft") + score("mouthSmileRight")) / 2, 0, 1),
    brow_down: clamp((score("browDownLeft") + score("browDownRight")) / 2, 0, 1),
    jaw_open: clamp(score("jawOpen"), 0, 1),
  };
}

export class FaceTracker {
  /** True once the landmarker is running. False means speech tasks only. */
  ready = false;
  /** Plain language reason the tracker is not running, shown on the setup screen. */
  reason = "";
  lights: Lights = { ...NO_LIGHTS };
  latest: FrameRec | null = null;
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private buffer: FrameRec[] = [];
  private keeping = false;
  private running = false;
  private handle = 0;
  private raf = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private times: number[] = [];
  private yaws: number[] = [];
  private pitches: number[] = [];
  private stamp = 0;

  /** Starts the landmarker and the frame loop. Returns false when only speech can run. */
  async start(video: HTMLVideoElement): Promise<boolean> {
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.canvas.width = SMALL;
    this.canvas.height = SMALL;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    try {
      const head = await fetch(MODEL_PATH, { method: "HEAD" }).catch(() => null);
      if (!head || !head.ok) throw new Error("the face model file is not on the server yet");
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = { wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl } as Fileset;
      this.landmarker = await this.build(vision.FaceLandmarker, fileset);
      this.ready = true;
      this.reason = "";
    } catch (err) {
      this.landmarker = null;
      this.ready = false;
      this.reason = err instanceof Error ? err.message : "the face measurement could not start";
    }
    this.running = true;
    this.loop();
    return this.ready;
  }

  /** GPU first, then CPU, because some phones refuse the GPU delegate. */
  private async build(cls: typeof FaceLandmarker, fileset: Fileset): Promise<FaceLandmarker> {
    const opts = {
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    };
    try {
      return await cls.createFromOptions(fileset, {
        ...opts,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      });
    } catch {
      return await cls.createFromOptions(fileset, {
        ...opts,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      });
    }
  }

  /** Stops the loop and releases the landmarker. */
  stop(): void {
    this.running = false;
    const video = this.video;
    if (video && this.handle && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(this.handle);
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.handle = 0;
    this.raf = 0;
    this.landmarker?.close();
    this.landmarker = null;
    this.video = null;
  }

  /** Turns frame buffering on at the start of a measured task and off at the end. */
  record(on: boolean): void {
    this.keeping = on;
    if (on) this.buffer = [];
  }

  /** Everything buffered since the task started, leaving the buffer empty. */
  take(): FrameRec[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  /** Throws the buffer away, used when a task is retried after a pause. */
  drop(): void {
    this.buffer = [];
  }

  /** Raw iris ratios, which is the best gaze estimate before the backend calibrates. */
  gaze(): Point {
    const rec = this.latest;
    return rec ? { x: clamp(rec.ratio.h, 0, 1), y: clamp(rec.ratio.v, 0, 1) } : { x: 0.5, y: 0.5 };
  }

  private loop(): void {
    const video = this.video;
    if (!video) return;
    const hook = typeof video.requestVideoFrameCallback === "function" ? video.requestVideoFrameCallback.bind(video) : null;
    const onVideoFrame = (_t: number, meta: VideoFrameCallbackMetadata) => {
      if (!this.running) return;
      this.read(meta.captureTime);
      this.handle = hook ? hook(onVideoFrame) : 0;
    };
    const onPaint = () => {
      if (!this.running) return;
      this.read(undefined);
      this.raf = requestAnimationFrame(onPaint);
    };
    if (hook) this.handle = hook(onVideoFrame);
    else this.raf = requestAnimationFrame(onPaint);
  }

  private read(cap: number | undefined): void {
    const video = this.video;
    const t = now();
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    this.tickFps(t);
    let rec: FrameRec | null = null;
    if (this.landmarker) {
      // MediaPipe wants a strictly increasing integer timestamp per video frame.
      this.stamp = Math.max(this.stamp + 1, Math.round(t));
      try {
        rec = this.record_of(this.landmarker.detectForVideo(video, this.stamp), video, t, cap);
      } catch {
        rec = null;
      }
    }
    if (!rec) rec = this.blank(video, t, cap);
    this.latest = rec;
    if (this.keeping) this.buffer.push(rec);
    this.lights = this.check(rec);
  }

  private record_of(res: FaceLandmarkerResult, video: HTMLVideoElement, t: number, cap?: number): FrameRec | null {
    const marks = res.faceLandmarks?.[0];
    if (!marks || marks.length < 478) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const a = this.eye(marks, EYE_A, IRIS_A, w, h);
    const b = this.eye(marks, EYE_B, IRIS_B, w, h);
    const head = pose(res.facialTransformationMatrixes?.[0]);
    this.remember(head);
    return {
      t,
      ...(cap && cap > 0 ? { cap } : {}),
      face: true,
      ratio: { h: clamp((a.h + b.h) / 2, -1, 2), v: clamp((a.v + b.v) / 2, -1, 2) },
      iris: { lx: clamp(a.x, -1, 2), ly: clamp(a.y, -1, 2), rx: clamp(b.x, -1, 2), ry: clamp(b.y, -1, 2) },
      iris_px: clamp((a.px + b.px) / 2, 0, 400),
      head,
      ear: { l: a.ear, r: b.ear },
      bright: this.brightness(video, marks, w, h),
      blend: shapes(res),
    };
  }

  /** A frame with no face. Brightness still comes from real pixels so flashes register. */
  private blank(video: HTMLVideoElement, t: number, cap?: number): FrameRec {
    return {
      t,
      ...(cap && cap > 0 ? { cap } : {}),
      face: false,
      ratio: { h: 0.5, v: 0.5 },
      iris: { lx: 0.5, ly: 0.5, rx: 0.5, ry: 0.5 },
      iris_px: 0,
      head: { yaw: 0, pitch: 0, roll: 0 },
      ear: { l: 0.3, r: 0.3 },
      bright: this.brightness(video, null, video.videoWidth, video.videoHeight),
      blend: { smile: 0, brow_down: 0, jaw_open: 0 },
    };
  }

  /** One eye: iris position inside the eye opening, iris diameter, and openness. */
  private eye(marks: Marks, eye: typeof EYE_A, iris: number[], w: number, h: number): EyeRead {
    const left = marks[eye.left];
    const right = marks[eye.right];
    const upper = marks[eye.upper];
    const lower = marks[eye.lower];
    const centre = marks[iris[0]];
    const wide = right.x - left.x;
    const tall = lower.y - upper.y;
    let sum = 0;
    for (let i = 1; i < iris.length; i += 1) {
      const p = marks[iris[i]];
      sum += Math.hypot((p.x - centre.x) * w, (p.y - centre.y) * h);
    }
    const span = Math.hypot(wide * w, (right.y - left.y) * h);
    const open = Math.hypot((lower.x - upper.x) * w, tall * h);
    return {
      h: Math.abs(wide) < 1e-6 ? 0.5 : (centre.x - left.x) / wide,
      v: Math.abs(tall) < 1e-6 ? 0.5 : (centre.y - upper.y) / tall,
      x: centre.x,
      y: centre.y,
      px: (sum / Math.max(1, iris.length - 1)) * 2,
      ear: clamp(span < 1e-6 ? 0.3 : open / span, 0, 1),
    };
  }

  /** Mean brightness of the face region, 0 to 1, off a 24 by 24 offscreen canvas. */
  private brightness(video: HTMLVideoElement, marks: Marks | null, w: number, h: number): number {
    const ctx = this.ctx;
    if (!ctx || !w || !h) return 0;
    let sx = 0;
    let sy = 0;
    let sw = w;
    let sh = h;
    if (marks) {
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const i of FACE_BOX) {
        const p = marks[i];
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      sx = clamp(x0, 0, 1) * w;
      sy = clamp(y0, 0, 1) * h;
      sw = Math.max(8, (clamp(x1, 0, 1) - clamp(x0, 0, 1)) * w);
      sh = Math.max(8, (clamp(y1, 0, 1) - clamp(y0, 0, 1)) * h);
    }
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SMALL, SMALL);
      const px = ctx.getImageData(0, 0, SMALL, SMALL).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      return clamp(sum / (px.length / 4) / 255, 0, 1);
    } catch {
      return 0;
    }
  }

  private remember(head: FrameRec["head"]): void {
    this.yaws.push(head.yaw);
    this.pitches.push(head.pitch);
    if (this.yaws.length > POSE_WINDOW) this.yaws.shift();
    if (this.pitches.length > POSE_WINDOW) this.pitches.shift();
  }

  private tickFps(t: number): void {
    this.times.push(t);
    if (this.times.length > FPS_WINDOW) this.times.shift();
  }

  private fps(): number {
    if (this.times.length < 4) return 0;
    const span = this.times[this.times.length - 1] - this.times[0];
    return span <= 0 ? 0 : ((this.times.length - 1) * 1000) / span;
  }

  /** True when the head has barely moved over the last second or so. */
  private steady(): boolean {
    if (this.yaws.length < 8) return false;
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    return spread(this.yaws) < STEADY_DEG && spread(this.pitches) < STEADY_DEG;
  }

  private check(rec: FrameRec): Lights {
    return {
      face: rec.face,
      dist: rec.face && rec.iris_px >= MIN_IRIS_PX && rec.iris_px <= MAX_IRIS_PX,
      light: rec.bright >= MIN_BRIGHT && rec.bright <= MAX_BRIGHT,
      steady: rec.face && this.steady(),
      fps: this.fps(),
      iris_px: rec.iris_px,
      bright: rec.bright,
    };
  }
}
