// P4 Gait and hearing. Two short extra checks, both optional, both on the patient's phone.
//
// The walk test counts steps from the accelerometer for twenty seconds and reports cadence
// and how even the steps were. The hearing test plays a quiet tone ladder at four
// frequencies and records the quietest one the patient could hear. Neither is a clinical
// audiogram or a gait lab, and the page says so.
//
// Every sensor here can be missing: iOS needs a tap before it will hand over motion data at
// all, and some phones never do. Both tests fall back to typing the answer in by hand.

import { Ear, Footprints, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useStretch } from "@/api/client";
import type { StretchResult } from "@/api/client";
import { Big } from "@/call/ui";
import { PatientShell } from "@/components/PatientShell";
import { Panel } from "@/components/common";
import { Input } from "@/components/ui/input";

const WALK_S = 20;
const STEP_GAP_MS = 260;
const STEP_THRESHOLD = 1.25;
const TONES = [500, 1000, 2000, 4000];
const LEVELS = [-20, -30, -40, -50, -60, -70, -80];
const TONE_MS = 1200;
const ANSWER_MS = 2400;

interface Motion {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** True when this phone will give motion data without being asked first. */
function hasMotion(): boolean {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window;
}

/* ---------------------------------------------------------------- the walk test */

interface Gait {
  steps: number;
  cadence: number;
  variability: number;
}

/** Counts steps from the accelerometer and works out cadence and step variability. */
function useWalk() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(WALK_S);
  const [result, setResult] = useState<Gait | null>(null);
  const [problem, setProblem] = useState("");
  const beats = useRef<number[]>([]);
  const level = useRef(0);
  const above = useRef(false);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    const onMotion = (ev: DeviceMotionEvent) => {
      const a = ev.accelerationIncludingGravity;
      if (!a) return;
      const size = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      level.current = level.current === 0 ? size : level.current * 0.9 + size * 0.1;
      const swing = size - level.current;
      const t = performance.now();
      const last = beats.current[beats.current.length - 1] ?? 0;
      if (swing > STEP_THRESHOLD && !above.current && t - last > STEP_GAP_MS) {
        beats.current.push(t);
        above.current = true;
      }
      if (swing < STEP_THRESHOLD * 0.4) above.current = false;
    };
    window.addEventListener("devicemotion", onMotion);
    const tick = window.setInterval(() => {
      const gone = (performance.now() - startedAt.current) / 1000;
      setLeft(Math.max(0, Math.ceil(WALK_S - gone)));
      if (gone >= WALK_S) stop();
    }, 250);

    function stop() {
      window.clearInterval(tick);
      window.removeEventListener("devicemotion", onMotion);
      setRunning(false);
      const times = beats.current;
      if (times.length < 4) {
        setProblem("I did not pick up enough steps to measure. You can type the number of steps in instead.");
        setResult(null);
        return;
      }
      const gaps: number[] = [];
      for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
      setResult({
        steps: times.length,
        cadence: Math.round((times.length / WALK_S) * 60),
        variability: Math.round((spread / Math.max(1, mean)) * 1000) / 10,
      });
    }

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [running]);

  async function begin() {
    setProblem("");
    setResult(null);
    beats.current = [];
    level.current = 0;
    above.current = false;
    if (!hasMotion()) {
      setProblem("This phone does not give the page its motion sensor. You can type the number of steps in instead.");
      return;
    }
    const api = (window as unknown as { DeviceMotionEvent: Motion }).DeviceMotionEvent;
    if (typeof api?.requestPermission === "function") {
      try {
        const answer = await api.requestPermission();
        if (answer !== "granted") {
          setProblem("Motion access was not allowed, so you can type the number of steps in instead.");
          return;
        }
      } catch {
        setProblem("Motion access was not allowed, so you can type the number of steps in instead.");
        return;
      }
    }
    startedAt.current = performance.now();
    setLeft(WALK_S);
    setRunning(true);
  }

  return { running, left, result, problem, begin, setResult };
}

/* ---------------------------------------------------------------- the hearing test */

interface Ladder {
  at: number;
  level: number;
  heard: Record<string, number>;
  playing: boolean;
}

/** A tone ladder: four frequencies, each stepping quieter until the patient stops hearing. */
function useTones(onDone: (thresholds: Record<string, number>) => void) {
  const [state, setState] = useState<Ladder>({ at: -1, level: 0, heard: {}, playing: false });
  const audio = useRef<AudioContext | null>(null);
  const timer = useRef(0);
  const answered = useRef(false);

  function context(): AudioContext | null {
    if (audio.current) return audio.current;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio.current = new Ctor();
    return audio.current;
  }

  function play(freq: number, db: number) {
    const ctx = context();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = Math.pow(10, db / 20);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(peak, ctx.currentTime + TONE_MS / 1000 - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + TONE_MS / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + TONE_MS / 1000 + 0.02);
  }

  function run(at: number, level: number, heard: Record<string, number>) {
    if (at >= TONES.length) {
      setState({ at, level: 0, heard, playing: false });
      onDone(heard);
      return;
    }
    if (level >= LEVELS.length) {
      run(at + 1, 0, heard);
      return;
    }
    answered.current = false;
    setState({ at, level, heard, playing: true });
    play(TONES[at], LEVELS[level]);
    timer.current = window.setTimeout(() => {
      if (answered.current) return;
      // Not heard at this level, so the one before it is the threshold for this tone.
      run(at + 1, 0, heard);
    }, ANSWER_MS);
  }

  function start() {
    const fresh: Record<string, number> = {};
    for (const freq of TONES) fresh[String(freq)] = 0;
    run(0, 0, fresh);
  }

  function heardIt() {
    if (!state.playing || answered.current) return;
    answered.current = true;
    window.clearTimeout(timer.current);
    const heard = { ...state.heard, [String(TONES[state.at])]: LEVELS[state.level] };
    run(state.at, state.level + 1, heard);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { state, start, heardIt };
}

/* ---------------------------------------------------------------- the page */

export default function Stretch() {
  const { token = "" } = useParams();
  const submit = useStretch();
  const walk = useWalk();
  const [manualSteps, setManualSteps] = useState("");
  const [tonesDone, setTonesDone] = useState<Record<string, number> | null>(null);
  const tones = useTones((heard) => setTonesDone(heard));
  const [sent, setSent] = useState("");

  function send(body: StretchResult, what: string) {
    submit.mutate({ token, result: body }, { onSuccess: () => setSent(what) });
  }

  function sendWalk() {
    const typed = Number(manualSteps);
    const gait = walk.result
      ? walk.result
      : Number.isFinite(typed) && typed > 0
        ? { steps: Math.round(typed), cadence: Math.round((typed / WALK_S) * 60), variability: 0 }
        : null;
    if (!gait) return;
    send({ gait }, "walk");
  }

  return (
    <PatientShell title="Walk and hearing checks">
      <Panel title="Two short checks" className="mb-5">
        <p className="text-sm leading-relaxed">
          One is a twenty second walk, the other is a short listening test with quiet tones. Both are optional and you
          can do one without the other.
        </p>
        <p className="mt-3 rounded-2xl border border-destructive/30 bg-destructive-soft p-3 text-sm leading-relaxed">
          Stop straight away and sit down if you feel dizzy, sick or unsteady. Do the walk somewhere clear, with a wall
          or a rail within reach, and with someone nearby if you can.
        </p>
      </Panel>

      <Panel title="The walk" subtitle="Hold the phone in your hand or put it in a front pocket, then walk at your normal pace for twenty seconds." className="mb-5">
        <Footprints className="h-6 w-6 text-primary" aria-hidden />
        {walk.running && (
          <p className="mt-3 text-2xl font-extrabold">
            {walk.left}
            <span className="ml-2 text-sm font-medium text-muted-foreground">seconds left, keep walking</span>
          </p>
        )}
        {walk.result && (
          <ul className="mt-3 space-y-1 text-sm">
            <li>Steps counted: {walk.result.steps}</li>
            <li>Steps per minute: {walk.result.cadence}</li>
            <li>How even your steps were: {walk.result.variability}% variation</li>
          </ul>
        )}
        {walk.problem && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{walk.problem}</p>}
        {(walk.problem || !walk.result) && !walk.running && (
          <div className="mt-3">
            <label className="block text-xs font-bold" htmlFor="steps">
              Or count your own steps for twenty seconds and type the number here
            </label>
            <Input
              id="steps"
              inputMode="numeric"
              value={manualSteps}
              onChange={(e) => setManualSteps(e.target.value)}
              className="mt-2 h-12"
              placeholder="for example 34"
            />
          </div>
        )}
        <div className="mt-4 space-y-3">
          {!walk.running && <Big onClick={() => void walk.begin()}>{walk.result ? "Walk again" : "Start the walk"}</Big>}
          <Big tone="outline" onClick={sendWalk} disabled={!walk.result && !Number(manualSteps)}>
            {sent === "walk" ? "Walk sent, thank you" : "Send my walk result"}
          </Big>
        </div>
      </Panel>

      <Panel title="The tones" subtitle="Somewhere quiet, at a comfortable volume. Tap the button the moment you hear a tone, even if it is very faint." className="mb-5">
        <Ear className="h-6 w-6 text-primary" aria-hidden />
        {tones.state.at >= 0 && tones.state.at < TONES.length && (
          <>
            <p className="mt-3 text-sm">
              Tone {tones.state.at + 1} of {TONES.length}, getting quieter.
            </p>
            <Big onClick={tones.heardIt} disabled={!tones.state.playing}>
              <Volume2 className="mr-2 h-5 w-5" aria-hidden /> I hear it
            </Big>
          </>
        )}
        {tonesDone && (
          <ul className="mt-3 space-y-1 text-sm">
            {TONES.map((freq) => (
              <li key={freq}>
                {freq} Hz: {tonesDone[String(freq)] ? `heard down to ${tonesDone[String(freq)]} dB` : "not heard"}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-3">
          {tones.state.at < 0 && <Big onClick={tones.start}>Start the tones</Big>}
          {tonesDone && (
            <Big tone="outline" onClick={() => send({ hearing: { thresholds: tonesDone } }, "tones")}>
              {sent === "tones" ? "Tones sent, thank you" : "Send my tone result"}
            </Big>
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          This is not a hearing test from a clinic. Phone speakers and headphones differ, so it shows a change over
          weeks rather than a true hearing level.
        </p>
      </Panel>

      {submit.isError && <p className="text-sm text-destructive">That did not send. Check your signal and try again.</p>}
    </PatientShell>
  );
}
