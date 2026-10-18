// Live call stream. A real WebSocket at /ws/rig when a backend is there, otherwise a seeded
// 30 fps generator so the live call console has something honest to draw in mock mode.

import { useEffect, useRef, useState } from "react";
import { mock } from "@/mock/db";
import { callScript } from "@/mock/call";
import { rng, round } from "@/mock/rng";
import { API, isMock, ready } from "./client";
import type { RigEvent } from "./types";

export type RigStatus = "Idle" | "Ringing" | "In call" | "Failed";

export interface TranscriptLine {
  who: "agent" | "patient";
  text: string;
  at: number;
}

export interface RigLive {
  last: RigEvent | null;
  transcript: TranscriptLine[];
  status: RigStatus;
  connected: boolean;
  eventsPerSec: number;
}

const STATUS: Record<string, RigStatus> = {
  idle: "Idle",
  ringing: "Ringing",
  in_call: "In call",
  failed: "Failed",
};

const STEPS = callScript().steps.map((s) => s.id);

const LINES: { who: "agent" | "patient"; text: string }[] = [
  { who: "agent", text: "Hello. This is your weekly check-in. I am software, not a person." },
  { who: "patient", text: "Okay, I am ready." },
  { who: "agent", text: "Follow the dot with your eyes and keep your head still." },
  { who: "patient", text: "Following it now." },
  { who: "agent", text: "Look at the dot as soon as it jumps." },
  { who: "agent", text: "Please read this passage out loud at your normal pace." },
  { who: "patient", text: "The river ran quietly past the old mill." },
  { who: "agent", text: "Now tell me all the words you remember from earlier." },
  { who: "patient", text: "Apple, river, candle, garden, and copper." },
  { who: "agent", text: "How has your headache been this week, from zero to ten?" },
  { who: "patient", text: "About a two." },
  { who: "agent", text: "That is everything. Your care team will see today's results." },
];

/** Websocket URL for the rig stream, derived from the API base so it follows the proxy. */
export function rigUrl(): string {
  if (API) return `${API.replace(/^http/, "ws")}/ws/rig`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/rig`;
}

/** Live rig state. Real events in live mode, seeded 30 fps events in mock mode. */
export function useRig(): RigLive {
  const [state, setState] = useState<RigLive>({
    last: null,
    transcript: [],
    status: "Idle",
    connected: false,
    eventsPerSec: 0,
  });
  const seen = useRef(0);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const rate = setInterval(() => {
      const count = seen.current;
      seen.current = 0;
      setState((s) => ({ ...s, eventsPerSec: count }));
    }, 1000);

    const push = (ev: RigEvent, status?: RigStatus) => {
      seen.current++;
      setState((s) => ({
        ...s,
        last: ev,
        connected: true,
        status: status ?? s.status,
        transcript: ev.line ? [...s.transcript.slice(-60), { ...ev.line, at: Date.now() }] : s.transcript,
      }));
    };

    ready().then(() => {
      if (stopped) return;

      if (!isMock()) {
        try {
          socket = new WebSocket(rigUrl());
          socket.onopen = () => setState((s) => ({ ...s, connected: true }));
          socket.onmessage = (m) => {
            try {
              push(JSON.parse(m.data as string) as RigEvent, "In call");
            } catch {
              setState((s) => ({ ...s, status: "Failed" }));
            }
          };
          socket.onerror = () => setState((s) => ({ ...s, status: "Failed" }));
          socket.onclose = () =>
            setState((s) => ({ ...s, connected: false, status: s.status === "In call" ? "Idle" : s.status }));
        } catch {
          setState((s) => ({ ...s, status: "Failed" }));
        }
        return;
      }

      const r = rng(20251017);
      const start = performance.now();
      let gain = 0.55;
      let lineIndex = 0;
      let nextLine = 2000;
      let quality = { face: true, dist: true, light: true };

      timer = setInterval(() => {
        const rig = mock.rigStatus();
        const status = STATUS[rig.status] ?? "Idle";
        const t = (performance.now() - start) / 1000;

        const target = { x: 0.5 + 0.35 * Math.sin(t * 1.3), y: 0.5 + 0.12 * Math.sin(t * 0.7) };
        const noise = () => (r.next() - 0.5) * 0.03;
        const gaze = { x: 0.5 + (target.x - 0.5) * 0.8 + noise(), y: 0.5 + (target.y - 0.5) * 0.8 + noise() };

        // Quality lights rarely flicker, then recover.
        if (r.next() < 0.004) quality = { face: r.next() > 0.3, dist: r.next() > 0.3, light: r.next() > 0.3 };
        else if (r.next() < 0.03) quality = { face: true, dist: true, light: true };

        gain += (0.8 - gain) * 0.01 + (r.next() - 0.5) * 0.004;

        const elapsed = status === "In call" ? Date.now() - rig.since : t * 1000;
        const step = STEPS[Math.floor(elapsed / 6000) % STEPS.length];
        let line: RigEvent["line"] = null;
        if (elapsed > nextLine) {
          line = LINES[lineIndex % LINES.length];
          lineIndex++;
          nextLine = elapsed + 2500 + r.next() * 2500;
        }

        push(
          {
            type: "frame",
            gaze,
            target,
            quality: { ...quality, fps: Math.round(29 + r.next() * 2) },
            pursuit_gain: round(gain, 3),
            step,
            line,
          },
          status,
        );
      }, 33);
    });

    return () => {
      stopped = true;
      clearInterval(rate);
      if (timer) clearInterval(timer);
      socket?.close();
    };
  }, []);

  return state;
}
