// Every post the call page makes.
//
// Three different promises are made to three different kinds of data. Live events are fire
// and forget, because a dropped one costs nothing but a missing dot on the clinician's
// console. Frames and audio are buffered and retried, because they are the measurement.
// Consent, red flags, symptoms and finish are awaited, because the call cannot carry on
// without the answer.
//
// Two routes take a shape the shared client cannot express: red flag answers are keyed by
// question key, and symptom scores are keyed by symptom key. Those two go out through a
// direct fetch here rather than changing the shared client, and fall back to the same mock
// layer the client uses when no backend is running.

import { API, api, isMock, ready } from "@/api/client";
import type { ConsentChoices } from "@/api/client";
import { mock } from "@/mock/db";
import type { CallStatus, FrameRec, RedflagResult, StimEvent, SymptomResult } from "@/api/types";
import { now, wait } from "./clock";
import type { Lights, Meta, Point, Stim } from "./types";

/** The backend takes 600 frames per post. */
const CHUNK = 600;
/** One live event every 200 ms, no faster. */
const LIVE_MS = 200;
const BACKOFF = [800, 1600, 3200, 6400, 8000];
const GIVE_UP = 12;
const TRIES = 3;

interface Job {
  run: () => Promise<unknown>;
  tries: number;
}

/** POST straight to a call route, bypassing the shared client's body shapes. */
async function direct<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Runs a gating post a few times before letting the error through. */
async function insist<T>(run: () => Promise<T>): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < TRIES; i += 1) {
    try {
      return await run();
    } catch (err) {
      last = err;
      await wait(700 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error("the clinic server did not answer");
}

export class Transport {
  private queue: Job[] = [];
  private busy = false;
  private lastLive = 0;
  private fps = 0;

  constructor(
    private token: string,
    private onPending: (count: number) => void,
  ) {}

  /** The screen and browser the measurements came from. */
  meta(): Meta {
    const w = typeof window === "undefined" ? 390 : window.innerWidth;
    const h = typeof window === "undefined" ? 844 : window.innerHeight;
    return {
      w_px: w,
      h_px: h,
      dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
      ua: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 380),
      fps: Math.min(Math.max(this.fps, 0), 90),
    };
  }

  /** How many buffered posts are still waiting, which drives the calm banner. */
  pending(): number {
    return this.queue.length;
  }

  private add(run: () => Promise<unknown>): void {
    this.queue.push({ run, tries: 0 });
    this.onPending(this.queue.length);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue[0];
      try {
        await job.run();
        this.queue.shift();
      } catch {
        job.tries += 1;
        if (job.tries >= GIVE_UP) this.queue.shift();
        else await wait(BACKOFF[Math.min(job.tries - 1, BACKOFF.length - 1)]);
      }
      this.onPending(this.queue.length);
    }
    this.busy = false;
  }

  /** Waits for the buffer to drain so finish is the last thing the backend sees. */
  async settle(limit = 20000): Promise<void> {
    const until = now() + limit;
    while (this.queue.length && now() < until) await wait(250);
  }

  /** A compact event for the clinician's live console. Never blocks a task. */
  live(step: string, gaze: Point, target: Point, lights: Lights): void {
    this.fps = lights.fps;
    const t = now();
    if (t - this.lastLive < LIVE_MS) return;
    this.lastLive = t;
    void api
      .callLive(this.token, {
        t,
        gaze,
        target,
        quality: { face: lights.face, dist: lights.dist, light: lights.light, fps: Math.round(lights.fps) },
        step,
      })
      .catch(() => {});
  }

  /** A spoken line, so the call has a transcript on the clinician side. */
  line(step: string, text: string): void {
    void api
      .callLive(this.token, {
        t: now(),
        gaze: { x: 0.5, y: 0.5 },
        target: { x: 0.5, y: 0.5 },
        quality: { face: false, dist: false, light: false, fps: Math.round(this.fps) },
        step,
        line: { who: "agent", text },
      })
      .catch(() => {});
  }

  /** One task's frames and stimulus log, chunked so no post is oversized. */
  frames(task: string, frames: FrameRec[], stim: Stim[]): void {
    if (!frames.length && !stim.length) return;
    const meta = this.meta();
    const parts = Math.max(1, Math.ceil(frames.length / CHUNK), Math.ceil(stim.length / CHUNK));
    for (let i = 0; i < parts; i += 1) {
      const f = frames.slice(i * CHUNK, (i + 1) * CHUNK);
      const s = stim.slice(i * CHUNK, (i + 1) * CHUNK) as StimEvent[];
      this.add(() => api.callFrames(this.token, task, meta, f, s));
    }
  }

  /** One speech recording. The only raw media that ever leaves the phone. */
  audio(task: string, blob: Blob, ext: string): void {
    this.add(() => api.callAudio(this.token, task, blob, `${task}.${ext}`));
  }

  consent(choices: ConsentChoices): Promise<unknown> {
    return insist(() => api.callConsent(this.token, choices));
  }

  /** The page sends the seven answers and obeys whatever comes back. It never decides. */
  async redflags(answers: Record<string, boolean>): Promise<RedflagResult> {
    await ready();
    if (isMock()) return mock.callRedflags(this.token, answers);
    return insist(() => direct<RedflagResult>(`/call/${this.token}/redflags`, { answers }));
  }

  async symptoms(scores: Record<string, number>, phase: "baseline" | "rerate"): Promise<SymptomResult> {
    await ready();
    if (isMock()) return mock.callSymptoms(this.token, scores, phase);
    return insist(() => direct<SymptomResult>(`/call/${this.token}/symptoms`, { scores, phase }));
  }

  /** One answer that is not a symptom score, such as the near point distance. */
  async answer(task: string, value: number | string[]): Promise<unknown> {
    await ready();
    return insist(() => api.callAnswer(this.token, task, value));
  }

  async finish(aborted: boolean): Promise<{ ok: boolean; call_id: string }> {
    await this.settle();
    return insist(() => api.callFinish(this.token, aborted));
  }

  status(): Promise<CallStatus> {
    return api.callStatus(this.token);
  }
}
