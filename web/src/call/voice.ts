// The voice, as the call page uses it. A pre-generated mp3 when the script named one,
// the browser's own voice when it did not, and the line on screen as a caption either way.
//
// This is a thin adapter over ./player, which owns the single audio element for the
// whole page. Nothing here keeps state of its own except the base url and the mute
// switch, because two Voice objects used to mean two elements playing at once.
//
// Nothing here ever blocks a task. Every play resolves: on end, on error, on being cut
// off by the next line, or on a timeout sized to the length of the line.

import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "@/api/client";
import * as player from "./player";

/** Tokens already spoken, so a remount does not say the same line twice.
 *
 * React runs an effect twice in StrictMode and a route change can leave two call pages
 * briefly alive. Either way the second run must not start the line again. Module scope
 * because a ref would be per component, and the duplicate is a second component.
 */
const said = new Set<string>();

/** Forgets what has been spoken. Called when a call starts, so a retry speaks again. */
export function resetSpoken(): void {
  said.clear();
}

export class Voice {
  muted = false;

  constructor(private base: string) {}

  /** Unlocks audio on iOS, which needs a user gesture before the first play. */
  prime(): void {
    player.prime();
  }

  /** Speaks one line and resolves when it is done or could not be spoken.
   *
   * Resolves true only when this line was still the current one when it finished. A
   * loop reading several lines in a row must check it and stop when it is false, or two
   * taps on Read this to me leave two loops running and reading over each other.
   *
   * The caption is not this module's job: every screen already shows the line it is
   * speaking, so a muted call reads exactly the same as a spoken one.
   */
  async say(text: string, file?: string, durationMs?: number): Promise<boolean> {
    if (this.muted) return false;
    return player.say(text, file ? this.url(file) : undefined, durationMs);
  }

  stop(): void {
    player.stop();
  }

  url(file: string): string {
    const base = this.base || "/voice/";
    const path = base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
    return path.startsWith("/") ? `${API}${path}` : path;
  }
}

/**
 * Says one line once, when its token becomes current, and gives you a Replay.
 *
 * `token` is what identifies the line: a step id, or a step id and question index. It
 * changing is what makes a new line play, and a play that resolves after it changed is
 * discarded by the player. Nothing here speaks during a render.
 */
export function useSpokenLine(
  voice: Voice,
  token: string,
  text: string,
  file?: string,
  durationMs?: number,
): { replay: () => void; speaking: boolean } {
  const [speaking, setSpeaking] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const play = useCallback(
    (again: boolean) => {
      if (!token || (!again && said.has(token))) return;
      said.add(token);
      setSpeaking(true);
      void voice.say(text, file, durationMs).then(() => {
        if (live.current) setSpeaking(false);
      });
    },
    [durationMs, file, text, token, voice],
  );

  useEffect(() => {
    play(false);
    // Leaving the line playing on unmount would talk over the next screen.
    return () => voice.stop();
  }, [play, voice]);

  return { replay: () => play(true), speaking };
}
