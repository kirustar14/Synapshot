// The voice. A pre-generated mp3 when the script named one, the browser's own voice when it
// did not or when the file is missing, and the line on screen as a caption either way.
//
// Nothing here ever blocks a task. Every play resolves: on end, on error, or on a timeout
// sized to the length of the line, whichever comes first.

import { API } from "@/api/client";
import { wait } from "./clock";

const CAP_MS = 45000;

export class Voice {
  muted = false;
  private el: HTMLAudioElement | null = null;

  constructor(private base: string) {}

  /** Unlocks audio on iOS, which needs a user gesture before the first play. */
  prime(): void {
    try {
      const el = new Audio();
      el.muted = true;
      void el.play().catch(() => {});
      window.speechSynthesis?.resume?.();
    } catch {
      // Nothing to unlock. The caption still carries the line.
    }
  }

  /** Speaks one line and resolves when it is done or could not be spoken.
   *
   * The caption is not this module's job: every screen already shows the line it is
   * speaking, so a muted call reads exactly the same as a spoken one.
   */
  async say(text: string, file?: string): Promise<void> {
    if (this.muted) return;
    if (file) {
      const played = await this.mp3(this.url(file));
      if (played) return;
    }
    await this.speak(text);
  }

  stop(): void {
    if (this.el) {
      this.el.pause();
      this.el = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Some browsers throw when cancelling an empty queue.
    }
  }

  private url(file: string): string {
    const base = this.base || "/voice/";
    const path = base.endsWith("/") ? `${base}${file}` : `${base}/${file}`;
    return path.startsWith("/") ? `${API}${path}` : path;
  }

  private mp3(url: string): Promise<boolean> {
    return new Promise((done) => {
      let settled = false;
      const el = new Audio(url);
      this.el = el;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        done(ok);
      };
      const guard = setTimeout(() => finish(true), CAP_MS);
      el.onended = () => finish(true);
      el.onerror = () => finish(false);
      el.play().catch(() => finish(false));
    });
  }

  private async speak(text: string): Promise<void> {
    const synth = typeof window === "undefined" ? null : window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      await wait(Math.min(CAP_MS, 1200 + text.length * 45));
      return;
    }
    await new Promise<void>((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        done();
      };
      const guard = setTimeout(finish, Math.min(CAP_MS, 1800 + text.length * 80));
      const line = new SpeechSynthesisUtterance(text);
      line.rate = 0.95;
      line.pitch = 1;
      line.onend = finish;
      line.onerror = finish;
      try {
        synth.cancel();
        synth.speak(line);
      } catch {
        finish();
      }
    });
  }
}
