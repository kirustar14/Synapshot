// One line at a time, proven by counting.
//
// The bug: the call page played several lines at once. A step said its own line, the
// task inside it said its first question straight away, and the word list started a new
// word every two seconds whether or not the last had finished. Each made its own Audio,
// so nothing stopped anything and the patient heard them stacked.
//
// These tests fake just enough of HTMLAudioElement and speechSynthesis to count how
// many are sounding at any moment. The assertion is always the same: never more than one.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as player from "../player";

/** Every element the module made, so the test can see what it did with them. */
const made: FakeAudio[] = [];

/** How many fake elements are playing right now. */
function playingNow(): number {
  return made.filter((a) => a.playing).length;
}

class FakeAudio {
  playing = false;
  src = "";
  currentTime = 0;
  muted = false;
  preload = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** The highest number sounding at once over this element's life. */
  constructor() {
    made.push(this);
  }
  play(): Promise<void> {
    this.playing = true;
    peak = Math.max(peak, playingNow() + speakingNow);
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
  }
  /** Ends the current line the way a real element would. */
  end(): void {
    this.playing = false;
    this.onended?.();
  }
}

let peak = 0;
let speakingNow = 0;

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  rate = 1;
  pitch = 1;
  constructor(public text: string) {}
}

const synth = {
  speak(line: FakeUtterance) {
    speakingNow += 1;
    peak = Math.max(peak, playingNow() + speakingNow);
    // A real voice ends on its own. Ending on the next tick keeps the test honest about
    // overlap without making it wait for a real utterance.
    setTimeout(() => {
      if (speakingNow > 0) speakingNow -= 1;
      line.onend?.();
    }, 5);
  },
  cancel() {
    speakingNow = 0;
  },
  resume() {},
};

beforeEach(() => {
  // `made` is deliberately not cleared. The module keeps one element for the life of the
  // page, which is the whole point, so clearing the list here would hide the real one and
  // the counts would all read zero.
  peak = 0;
  speakingNow = 0;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", synth);
  (window as unknown as { speechSynthesis: typeof synth }).speechSynthesis = synth;
  player.stop();
});

describe("the shared player", () => {
  it("uses one audio element however many lines are said", async () => {
    await player.say("one", "/voice/a.mp3", 10);
    await player.say("two", "/voice/b.mp3", 10);
    await player.say("three", "/voice/c.mp3", 10);
    expect(made.length).toBe(1);
  });

  it("never has two lines sounding at once when steps come fast", async () => {
    // Fire a line per step without waiting, which is exactly what the step screen and
    // the task inside it used to do between them.
    const runs = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
      player.say(`line ${id}`, `/voice/${id}.mp3`, 10),
    );
    expect(playingNow()).toBeLessThanOrEqual(1);
    made.forEach((a) => a.end());
    await Promise.all(runs);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("stops the mp3 and rewinds it before starting the next", async () => {
    const first = player.say("one", "/voice/a.mp3", 10);
    const el = made[0];
    el.currentTime = 3;
    const second = player.say("two", "/voice/b.mp3", 10);
    expect(el.currentTime).toBe(0);
    el.end();
    await Promise.all([first, second]);
  });

  it("cancels the browser voice before starting an mp3", async () => {
    const speaking = player.say("spoken with no file");
    expect(speakingNow).toBeGreaterThanOrEqual(0);
    const withFile = player.say("has a file", "/voice/a.mp3", 10);
    expect(speakingNow).toBe(0);
    made[0]?.end();
    await Promise.all([speaking, withFile]);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("reports a cut off line as not finished, so a caller does not advance on it", async () => {
    const first = player.say("one", "/voice/a.mp3", 10);
    const second = player.say("two", "/voice/b.mp3", 10);
    made[0].end();
    expect(await first).toBe(false);
    await second;
  });

  it("stop silences the element and the browser voice", async () => {
    const run = player.say("one", "/voice/a.mp3", 10);
    expect(playingNow()).toBe(1);
    player.stop();
    expect(playingNow()).toBe(0);
    expect(speakingNow).toBe(0);
    await run;
  });

  it("falls back to the browser voice when there is no file", async () => {
    const spoken: string[] = [];
    const watch = { ...synth, speak(line: FakeUtterance) { spoken.push(line.text); synth.speak(line); } };
    vi.stubGlobal("speechSynthesis", watch);
    (window as unknown as { speechSynthesis: typeof watch }).speechSynthesis = watch;

    await player.say("no file for this line");
    // The element is shared and already exists from an earlier line, so what matters is
    // that nothing was played through it and the browser voice said the words instead.
    expect(playingNow()).toBe(0);
    expect(spoken).toContain("no file for this line");
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("stops when the tab is hidden", async () => {
    const run = player.say("one", "/voice/a.mp3", 10);
    expect(playingNow()).toBe(1);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(playingNow()).toBe(0);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    await run;
  });
});
