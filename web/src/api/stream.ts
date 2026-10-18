// The patient event stream. One EventSource per open workspace.
//
// This replaces the rig websocket. Server-sent events rather than a socket because every
// message goes one way, EventSource reconnects on its own when a tunnel drops it, and
// there is no handshake to get wrong behind a proxy.
//
// The stream is per patient: a clinician with one chart open is never sent another
// patient's measurements, which matters when the screen is visible to someone else.

import { useEffect, useRef, useState } from "react";
import { mock } from "@/mock/db";
import { API, isMock, ready } from "./client";

export interface GazePoint {
  x: number;
  y: number;
}

export interface Quality {
  face: boolean;
  dist: boolean;
  light: boolean;
  fps: number;
}

/** One live measurement tick from the phone, about five a second while a task runs. */
export interface FrameEvent {
  kind: "frame";
  t: number;
  step: string;
  gaze: GazePoint;
  target: GazePoint;
  quality: Quality;
  pursuit_gain: number | null;
  line: { who: string; text: string } | null;
}

export interface StageEvent {
  kind: "stage";
  t: number;
  name: string;
  say: string;
}

export interface AlertEvent {
  kind: "alert";
  t: number;
  id: string;
  type: string;
  trigger: string;
}

export interface DoneEvent {
  kind: "call_done";
  t: number;
  call_id: string;
  week: number;
  alerts: string[];
  drift_z: number;
  quality_ok: boolean;
}

export interface FailedEvent {
  kind: "call_failed";
  t: number;
  week: number;
  error: string;
}

export interface HelloEvent {
  kind: "hello";
  t?: number;
  patient_id: string;
}

export type PatientEvent =
  | FrameEvent
  | StageEvent
  | AlertEvent
  | DoneEvent
  | FailedEvent
  | HelloEvent;

export interface StreamState {
  /** The most recent measurement tick, for the strip in the call modal. */
  frame: FrameEvent | null;
  /** What the pipeline is doing right now, after the call ends. */
  stage: StageEvent | null;
  /** Set once when a call lands, so the workspace can refetch and animate. */
  done: DoneEvent | null;
  failed: FailedEvent | null;
  /** Alerts pushed while this stream was open, newest last. */
  alerts: AlertEvent[];
  connected: boolean;
  /** Measurement ticks a second, which is the honest "is this live" indicator. */
  rate: number;
}

const EMPTY: StreamState = {
  frame: null,
  stage: null,
  done: null,
  failed: null,
  alerts: [],
  connected: false,
  rate: 0,
};

/**
 * Subscribe to one patient's events.
 *
 * Returns the latest of each kind rather than the whole history. A clinician watching a
 * call wants the current gaze dot and the current stage; the measurements that matter are
 * posted in whole chunks and read back through the normal queries once the call lands.
 */
export function usePatientStream(patientId: string | null, enabled = true): StreamState {
  const [state, setState] = useState<StreamState>(EMPTY);
  const ticks = useRef<number[]>([]);

  useEffect(() => {
    if (!patientId || !enabled) {
      setState(EMPTY);
      return;
    }
    let live = true;
    let source: EventSource | null = null;
    let timer: number | null = null;

    const take = (event: PatientEvent) => {
      if (!live) return;
      if (event.kind === "frame") {
        const now = Date.now();
        ticks.current = [...ticks.current.filter((t) => now - t < 1000), now];
      }
      setState((prev) => {
        const rate = ticks.current.length;
        switch (event.kind) {
          case "frame":
            return { ...prev, frame: event, connected: true, rate };
          case "stage":
            return { ...prev, stage: event, connected: true };
          case "alert":
            return { ...prev, alerts: [...prev.alerts, event], connected: true };
          case "call_done":
            return { ...prev, done: event, stage: null, connected: true };
          case "call_failed":
            return { ...prev, failed: event, stage: null, connected: true };
          default:
            return { ...prev, connected: true };
        }
      });
    };

    (async () => {
      await ready();
      if (!live) return;

      if (isMock()) {
        // No backend. Drive the same shapes off the mock layer so the strip is honest
        // about being generated rather than showing a frozen dot.
        timer = window.setInterval(() => take(mock.frameEvent(patientId)), 200);
        setState((prev) => ({ ...prev, connected: true }));
        return;
      }

      source = new EventSource(`${API}/api/patients/${patientId}/stream`);
      source.onopen = () => setState((prev) => ({ ...prev, connected: true }));
      source.onerror = () => setState((prev) => ({ ...prev, connected: false }));
      // Every event is named by kind, so one listener per kind beats parsing a union.
      for (const kind of ["hello", "frame", "stage", "alert", "call_done", "call_failed"]) {
        source.addEventListener(kind, (raw) => {
          try {
            take(JSON.parse((raw as MessageEvent).data) as PatientEvent);
          } catch {
            // A malformed message is dropped. The next one is 200 ms away.
          }
        });
      }
    })();

    // The rate decays on its own, so a stalled stream reads zero instead of holding
    // whatever number it had when the phone stopped sending.
    const decay = window.setInterval(() => {
      const now = Date.now();
      ticks.current = ticks.current.filter((t) => now - t < 1000);
      setState((prev) => (prev.rate === ticks.current.length ? prev : { ...prev, rate: ticks.current.length }));
    }, 500);

    return () => {
      live = false;
      source?.close();
      if (timer !== null) window.clearInterval(timer);
      window.clearInterval(decay);
      ticks.current = [];
    };
  }, [patientId, enabled]);

  return state;
}
