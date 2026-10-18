import { useEffect, useRef, useState } from "react";
import { API, getMode } from "./client";
import { mock } from "@/mock/db";
import type { RigEvent } from "./types";

export type RigStatus = "Idle" | "Ringing" | "In call" | "Failed";

export interface RigLive {
  last: RigEvent | null;
  transcript: { who: "agent" | "patient"; text: string; at: number }[];
  status: RigStatus;
  connected: boolean;
  eventsPerSec: number;
}

const SCRIPT = ["Greeting", "Calibration", "Smooth pursuit", "Saccades", "Flash test", "Reading passage", "Word list", "Digit span", "Symptom check", "Goodbye"];
const LINES: { who: "agent" | "patient"; text: string }[] = [
  { who: "agent", text: "Hi, this is your weekly check-in. Is now a good time?" },
  { who: "patient", text: "Yes, go ahead." },
  { who: "agent", text: "Please look at the dot and follow it with your eyes." },
  { who: "patient", text: "Okay, following it." },
  { who: "agent", text: "Great. Now look at each dot as it appears." },
  { who: "agent", text: "Please read this short passage out loud." },
  { who: "patient", text: "The river ran quietly past the old mill..." },
  { who: "agent", text: "I will say five words. Repeat them when I finish." },
  { who: "patient", text: "Apple, river, candle, garden, ... button." },
  { who: "agent", text: "How is your headache today, from zero to six?" },
  { who: "patient", text: "About a two." },
  { who: "agent", text: "Thank you. Your care team will see today's results." },
];

const statusMap: Record<string, RigStatus> = { idle: "Idle", ringing: "Ringing", in_call: "In call", failed: "Failed" };

/** Live rig stream. Real WebSocket in live mode, synthetic 30 fps events in mock mode. */
export function useRig(): RigLive {
  const [state, setState] = useState<RigLive>({ last: null, transcript: [], status: "Idle", connected: false, eventsPerSec: 0 });
  const countRef = useRef(0);

  useEffect(() => {
    let stop = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const rate = setInterval(() => { const n = countRef.current; countRef.current = 0; setState((s) => ({ ...s, eventsPerSec: n })); }, 1000);

    const push = (ev: RigEvent, status?: RigStatus) => {
      countRef.current++;
      setState((s) => ({
        ...s, last: ev, connected: true, status: status ?? s.status,
        transcript: ev.line ? [...s.transcript.slice(-60), { ...ev.line, at: Date.now() }] : s.transcript,
      }));
    };

    getMode().then((mode) => {
      if (stop) return;
      if (mode === "live") {
        const url = API.replace(/^http/, "ws") + "/ws/rig";
        try {
          ws = new WebSocket(url);
          ws.onopen = () => setState((s) => ({ ...s, connected: true }));
          ws.onmessage = (m) => { try { const ev = JSON.parse(m.data) as RigEvent; push(ev, "In call"); } catch { /* ignore */ } };
          ws.onerror = () => setState((s) => ({ ...s, status: "Failed" }));
          ws.onclose = () => setState((s) => ({ ...s, connected: false, status: s.status === "In call" ? "Idle" : s.status }));
        } catch {
          setState((s) => ({ ...s, status: "Failed" }));
        }
        return;
      }
      // mock generator
      const start = performance.now();
      let gain = 0.55;
      let lineIdx = 0;
      let nextLine = 2000;
      let flick = { face: true, dist: true, light: true };
      timer = setInterval(() => {
        const rs = mock.rigStatus();
        const status = statusMap[rs.status];
        const t = (performance.now() - start) / 1000;
        const target = { x: 0.5 + 0.35 * Math.sin(t * 1.3), y: 0.5 + 0.12 * Math.sin(t * 0.7) };
        const noise = () => (Math.random() - 0.5) * 0.03;
        const gaze = { x: 0.5 + (target.x - 0.5) * 0.8 + noise(), y: 0.5 + (target.y - 0.5) * 0.8 + noise() };
        if (Math.random() < 0.004) flick = { face: Math.random() > 0.3, dist: Math.random() > 0.3, light: Math.random() > 0.3 };
        else if (Math.random() < 0.03) flick = { face: true, dist: true, light: true };
        gain += (0.8 - gain) * 0.01 + (Math.random() - 0.5) * 0.004;
        const inCall = status === "In call";
        const elapsed = inCall ? Date.now() - rs.since : t * 1000;
        const step = SCRIPT[Math.floor(elapsed / 6000) % SCRIPT.length];
        let line: RigEvent["line"] = null;
        if (elapsed > nextLine) { line = LINES[lineIdx % LINES.length]; lineIdx++; nextLine = elapsed + 2500 + Math.random() * 2500; }
        push({
          type: "frame", gaze, target, quality: { ...flick, fps: Math.round(29 + Math.random() * 2) },
          pursuit_gain: Math.round(gain * 1000) / 1000, step, line,
        }, status);
      }, 33);
    });

    return () => { stop = true; clearInterval(rate); if (timer) clearInterval(timer); ws?.close(); };
  }, []);

  return state;
}
