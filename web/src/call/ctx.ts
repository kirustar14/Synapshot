// What every task needs from the call runner. One context so a task component stays a
// screen and nothing more: it draws, it measures, it says when it is done.

import { createContext, useContext } from "react";
import type { CallScript } from "@/api/types";
import type { StimLog } from "./stim";
import type { Transport } from "./transport";
import type { FaceTracker } from "./vision";
import type { Voice } from "./voice";
import type { Point } from "./types";

export interface CallCtx {
  script: CallScript;
  stim: StimLog;
  post: Transport;
  tracker: FaceTracker;
  voice: Voice;
  /** The microphone, which answers false from start when this browser cannot record. */
  recorder: { start: () => boolean; stop: () => Promise<{ blob: Blob; ext: string } | null> };
  /** Where the stimulus is now, published for the clinician's live console. */
  setTarget: (p: Point) => void;
  /** This task is finished, move on. */
  done: () => void;
  /** Do not run these step ids, from the symptom route's skip list. */
  skip: (ids: string[]) => void;
  /** The backend said stop. The page only obeys. */
  stop: (say: string, audio?: string) => void;
}

export const Ctx = createContext<CallCtx | null>(null);

/** The call context, which only exists inside the call page. */
export function useCall(): CallCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error("useCall was used outside the call page");
  return value;
}
