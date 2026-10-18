// Counts how many things are making sound at once during a real call.
//
// The unit tests in src/call/__tests__/player.test.ts fake the audio element and prove
// the module never starts a second line. This proves the same thing in a browser, where
// the page is really mounting components, really running effects twice under StrictMode
// in dev, and really has a camera stream alongside the voice.
//
// It needs a backend with seeded patients. `npm run e2e` after `make dev` on :8111.

import { expect, test } from "@playwright/test";

// A fake camera and microphone, granted without a prompt. Without these the call stops
// at the permission screen and the test proves nothing about the lines that follow.
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

/** Patches the page so every play and pause is counted before the app loads. */
const WATCH = `
  window.__audio = { peak: 0, now: 0, plays: 0, elements: 0 };
  const origPlay = HTMLMediaElement.prototype.play;
  const origPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function () {
    // A muted element makes no sound, and the self view video is always muted.
    if (!this.muted && this.tagName === "AUDIO") {
      window.__audio.now += 1;
      window.__audio.plays += 1;
      window.__audio.peak = Math.max(window.__audio.peak, window.__audio.now);
      this.addEventListener("ended", () => { window.__audio.now = Math.max(0, window.__audio.now - 1); }, { once: true });
    }
    return origPlay.apply(this, arguments);
  };
  HTMLMediaElement.prototype.pause = function () {
    if (!this.muted && this.tagName === "AUDIO" && window.__audio.now > 0) window.__audio.now -= 1;
    return origPause.apply(this, arguments);
  };
  const origAudio = window.Audio;
  window.Audio = function (...args) { window.__audio.elements += 1; return new origAudio(...args); };
  window.Audio.prototype = origAudio.prototype;

  // The browser voice counts too: an mp3 over a spoken line is the same bug.
  window.__speech = { peak: 0, now: 0 };
  const synth = window.speechSynthesis;
  if (synth) {
    const origSpeak = synth.speak.bind(synth);
    const origCancel = synth.cancel.bind(synth);
    synth.speak = (line) => {
      window.__speech.now += 1;
      window.__speech.peak = Math.max(window.__speech.peak, window.__speech.now);
      line.addEventListener("end", () => { window.__speech.now = Math.max(0, window.__speech.now - 1); });
      return origSpeak(line);
    };
    synth.cancel = () => { window.__speech.now = 0; return origCancel(); };
  }
`;

test("never plays two lines at once during a call", async ({ page, request }) => {
  const list = await request.get("/api/patients");
  expect(list.ok()).toBeTruthy();
  const pid = (await list.json())[0].id;

  const made = await request.post("/api/calls", { data: { patient_id: pid, send: false } });
  expect(made.ok()).toBeTruthy();
  const token = (await made.json()).token;

  await page.addInitScript(WATCH);
  await page.goto(`/call/${token}`);

  // Read this to me, pressed three times as fast as the browser allows. This is the
  // sharpest version of the bug: three plays of a long line, started on top of each
  // other, with nothing waiting in between.
  const read = page.getByRole("button", { name: /Read this to me/i });
  await read.waitFor();
  for (let i = 0; i < 3; i += 1) {
    await read.click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => ({ audio: window.__audio, speech: window.__speech }));
    expect(mid.audio.now + mid.speech.now, "a second line started over the first").toBeLessThanOrEqual(1);
  }
  const afterRead = await page.evaluate(() => ({ audio: window.__audio, speech: window.__speech }));
  expect(afterRead.audio.plays + afterRead.speech.peak, "Read this to me said nothing").toBeGreaterThan(0);

  // The consent toggles are switches, not checkboxes. All three required ones have to be
  // on before the start button does anything.
  await page.waitForSelector('[role="switch"]');
  for (const sw of await page.getByRole("switch").all()) {
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  }
  await page.getByRole("button", { name: /I agree, start the check-in/i }).click();
  await page.waitForTimeout(1200);

  // Step through whatever the script puts in front of us. Every one of these clicks is a
  // new spoken line, which is the exact moment the old code stacked them on top of each
  // other: the step screen said its line and the task inside it said its first question.
  // How far this gets: consent, the setup step, the camera permission, and the face
  // gate. Each of those is a step screen that speaks its own line, and the two screens
  // either side of a step change are where lines used to land on top of each other.
  //
  // It stops at the face gate, because Chrome's fake camera is a rolling test pattern
  // and MediaPipe finds no face in it, so the tasks past that point are not reachable
  // here. Those are covered exhaustively by src/call/__tests__/player.test.ts, which
  // fakes the element and can step the whole script in milliseconds. What this test adds
  // is a real browser, real effects running twice under StrictMode, and a real camera
  // stream alongside the voice.
  let clicks = 1; // the consent click above, which is the first step change
  const screens = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    screens.add(await page.locator("h1,h2").first().innerText().catch(() => ""));
    const next = page
      .getByRole("button", { name: /^(I am ready|Yes|No|Continue|Next|Allow|Start|Say that again)/i })
      .first();
    if ((await next.count()) && (await next.isEnabled().catch(() => false))) {
      await next.click({ timeout: 4000 }).catch(() => {});
      clicks += 1;
    }
    await page.waitForTimeout(350);

    const got = await page.evaluate(() => ({ audio: window.__audio, speech: window.__speech }));
    expect(got.audio.peak, "two mp3s playing at once").toBeLessThanOrEqual(1);
    expect(got.speech.peak, "two spoken lines at once").toBeLessThanOrEqual(1);
    expect(got.audio.now + got.speech.now, "an mp3 over a spoken line").toBeLessThanOrEqual(1);
  }

  const end = await page.evaluate(() => ({ audio: window.__audio, speech: window.__speech }));
  // A test that clicked nothing and played nothing would pass every assertion above
  // while proving nothing at all, so it has to have actually driven the call and the
  // call has to have actually said something.
  expect(clicks, "the test never advanced the call").toBeGreaterThan(1);
  // Two screens inside the loop, Set your phone up and the face gate, on top of the
  // consent screen before it. That is two step changes, and a step change is exactly
  // where a line used to start before the last one had stopped.
  expect(screens.size, "the call never moved between screens").toBeGreaterThanOrEqual(2);
  expect(end.audio.plays + end.speech.peak, "no line was ever spoken").toBeGreaterThan(0);
  // One element for the whole call, however many lines were said through it.
  expect(end.audio.elements, "the page made more than one audio element").toBeLessThanOrEqual(1);
});
