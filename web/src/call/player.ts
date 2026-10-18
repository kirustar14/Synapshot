// The one voice on the call page. Everything spoken goes through this module.
//
// The bug this exists for: the page used to play several lines at once. A step screen
// said its own line, the task inside it immediately said its first question, and the
// word list fired a new word every two seconds whether or not the last had finished.
// Each of those made its own Audio element, so nothing ever stopped anything else and
// the patient heard three lines read over each other.
//
// So there is exactly one audio element and one speech queue in the whole page, owned
// here at module scope rather than by a component. Module scope matters: React mounts a
// component twice in StrictMode and a route change can briefly have two call pages
// alive, and an element owned by a component would become two elements playing at once,
// which is the bug again.
//
// Every play is stamped with the generation it started in. Starting anything bumps the
// generation, so a play that resolves after the step moved on knows it is stale and
// says nothing.

let el: HTMLAudioElement | null = null;
let gen = 0;
let timer = 0;
let speaking = false;

/**
 * Settles whatever play is in flight, so cutting a line off does not hang its caller.
 *
 * Without this, stopping detached the element's handlers and cleared the timeout, which
 * meant the promise behind the current line never resolved. The word list awaits each
 * word before starting the next, so one interruption stopped it forever.
 */
let settle: (() => void) | null = null;

/** The longest any single line is allowed to hold the call. */
const CAP_MS = 45000;

/** The shared element, made on first use. One per page, never per component. */
function audio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.preload = "auto";
  }
  return el;
}

/** Silences everything and invalidates any play still in flight. */
export function stop(): void {
  gen += 1;
  speaking = false;
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  // Settle before detaching anything, or the promise behind the line being cut off
  // never resolves and whoever was waiting on it waits for the rest of the call.
  const done = settle;
  settle = null;
  done?.();
  const got = el;
  if (got) {
    try {
      got.pause();
      got.currentTime = 0;
      // Dropping the handlers as well: a paused element can still fire error, and a
      // stale handler resolving a promise nobody is waiting on is how this leaked before.
      got.onended = null;
      got.onerror = null;
    } catch {
      // An element that was never played throws on currentTime. Nothing to undo.
    }
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Some browsers throw when cancelling an empty queue.
  }
}

/** True while a line is actually being spoken, for the Replay button's disabled state. */
export function busy(): boolean {
  return speaking;
}

/**
 * Unlocks audio on iOS, which will not play without a user gesture first.
 *
 * Called from the tap that starts the call, never from a render.
 */
export function prime(): void {
  const got = audio();
  if (!got) return;
  try {
    got.muted = true;
    void got.play().then(() => {
      got.pause();
      got.muted = false;
    }).catch(() => {
      got.muted = false;
    });
    window.speechSynthesis?.resume?.();
  } catch {
    // Nothing to unlock. The caption still carries the line.
  }
}

/**
 * Speaks one line and resolves when it has ended, failed, or been cut off.
 *
 * Resolves true only when this play was still the current one when it finished. A
 * caller that waits on this to advance will not advance on a line the user already
 * skipped past.
 */
export async function say(text: string, file?: string, durationMs?: number): Promise<boolean> {
  stop();
  const mine = gen;
  speaking = true;
  const ok = file ? await mp3(file, mine, durationMs) : false;
  if (!ok && gen === mine) await speak(text, mine);
  if (gen !== mine) return false;
  speaking = false;
  return true;
}

function mp3(url: string, mine: number, durationMs?: number): Promise<boolean> {
  const got = audio();
  if (!got) return Promise.resolve(false);
  return new Promise((done) => {
    let settled = false;
    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (settle === cut) settle = null;
      got.onended = null;
      got.onerror = null;
      done(gen === mine && played);
    };
    const cut = () => finish(false);
    settle = cut;
    // The timeout is the length of the line plus a second, when the manifest knew it.
    // A line whose ended event never arrives would otherwise stall the whole call.
    const cap = Math.min(CAP_MS, durationMs ? durationMs + 1000 : CAP_MS);
    timer = window.setTimeout(() => finish(true), cap);
    got.onended = () => finish(true);
    got.onerror = () => finish(false);
    try {
      got.src = url;
      got.currentTime = 0;
      void got.play().catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

function speak(text: string, mine: number): Promise<void> {
  const synth = typeof window === "undefined" ? null : window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    // No browser voice either. Hold for about as long as the line would have taken, so
    // the caption is on screen long enough to read.
    return new Promise((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (settle === finish) settle = null;
        done();
      };
      settle = finish;
      timer = window.setTimeout(finish, Math.min(CAP_MS, 1200 + text.length * 45));
    });
  }
  return new Promise((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      if (settle === finish) settle = null;
      done();
    };
    settle = finish;
    timer = window.setTimeout(finish, Math.min(CAP_MS, 1800 + text.length * 80));
    const line = new SpeechSynthesisUtterance(text);
    line.rate = 0.95;
    line.pitch = 1;
    line.onend = finish;
    line.onerror = finish;
    try {
      if (gen !== mine) {
        finish();
        return;
      }
      synth.speak(line);
    } catch {
      finish();
    }
  });
}

// Anything that takes the call off screen silences it. Without this a backgrounded tab
// keeps talking, and coming back lands in the middle of a line with no way to replay it.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  window.addEventListener("pagehide", stop);
}
