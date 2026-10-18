// The call itself. Owns the camera, the landmarker, the microphone, the voice, the stimulus
// log, the posts and the state machine, and hands all of it to one task at a time.
//
// Two loops run for the whole call. The measurement loop lives in FaceTracker and runs on
// every video frame. The supervision loop here runs four times a second: it refreshes the
// setup lights, posts a live event for the clinician's console, and tells the state machine
// whether the camera can still see a face. Nothing in the supervision loop can block a task.
//
// A paused task is an unmounted task. That is deliberate: unmounting throws away the frames
// of the attempt that went wrong, and resuming remounts with a new attempt number, which
// writes a fresh task marker. The backend then sees one clean window instead of two halves.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CallScript } from "@/api/types";
import { useCallStore } from "./callStore";
import { now } from "./clock";
import type { CallCtx } from "./ctx";
import { Ctx } from "./ctx";
import { current as currentSlot, init, minutesLeft, progress, reduce, WATCHED } from "./machine";
import * as media from "./media";
import { ConsentStage, EmergencyStage, SetupStage, StepIntro, StoppedStage } from "./stages";
import type { MediaState } from "./stages";
import { StimLog } from "./stim";
import { TaskView, spokenOnly } from "./tasks";
import { Transport } from "./transport";
import { NO_LIGHTS } from "./types";
import type { Lights, Point } from "./types";
import { Banner, Big, Chrome, PausedOverlay, Stage, contrastVars } from "./ui";
import { FaceTracker } from "./vision";
import { Voice } from "./voice";
import { keepAwake, lockViewport, setTextScale } from "./wake";

const TICK_MS = 250;

/** Eye tasks that cannot run without the landmarker. The picture task still records voice. */
const EYE_TASKS = WATCHED.filter((task) => task !== "picture");

type Leaving = "" | "ask" | "going" | "told";

/** The ids of this script's eye steps, which cannot run without a working camera. */
function eyeStepIds(script: CallScript): string[] {
  return script.steps.filter((s) => EYE_TASKS.includes(s.task)).map((s) => s.id);
}

export function CallRunner({ token, script }: { token: string; script: CallScript }) {
  const [state, send] = useReducer(reduce, script, init);
  const prefs = useCallStore();
  const [lights, setLights] = useState<Lights>(NO_LIGHTS);
  const [mediaState, setMediaState] = useState<MediaState>("idle");
  const [mediaError, setMediaError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [modelReason, setModelReason] = useState("");
  const [phase, setPhase] = useState<"intro" | "task">("intro");
  const [leaving, setLeaving] = useState<Leaving>("");

  const stim = useMemo(() => new StimLog(), []);
  const tracker = useMemo(() => new FaceTracker(), []);
  const voice = useMemo(() => new Voice(script.voice_base), [script.voice_base]);
  const post = useMemo(() => new Transport(token, (count) => useCallStore.getState().setPending(count)), [token]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<media.Recorder | null>(null);
  const target = useRef<Point>({ x: 0.5, y: 0.5 });
  const liveOn = useRef(false);
  const faceOn = useRef(false);
  const stepRef = useRef("setup");

  const slot = currentSlot(state);
  const step = slot?.step ?? null;

  /* ---- phone housekeeping ---- */

  useEffect(() => {
    const release = keepAwake();
    const unlock = lockViewport();
    return () => {
      release();
      unlock();
      setTextScale(false);
      voice.stop();
    };
  }, [voice]);

  useEffect(() => setTextScale(prefs.bigText), [prefs.bigText]);
  useEffect(() => {
    voice.muted = prefs.muted;
  }, [prefs.muted, voice]);

  useEffect(
    () => () => {
      tracker.stop();
      media.close(streamRef.current);
    },
    [tracker],
  );

  /* ---- camera, landmarker and microphone, in one permission prompt ---- */

  const ask = useCallback(async () => {
    setMediaState("asking");
    setMediaError("");
    try {
      const got = await media.open();
      streamRef.current = got;
      setStream(got);
      recorderRef.current = new media.Recorder(got);
      const el = videoRef.current;
      if (el) {
        el.srcObject = got;
        await el.play().catch(() => {});
        const ready = await tracker.start(el);
        if (!ready) {
          setModelReason(tracker.reason);
          send({ type: "skip", ids: eyeStepIds(script) });
        }
      }
      setMediaState("ready");
    } catch (err) {
      setMediaError(media.why(err));
      setMediaState("denied");
    }
  }, [script, tracker]);

  /* ---- the supervision loop ---- */

  useEffect(() => {
    const id = window.setInterval(() => {
      const got = tracker.lights;
      setLights(got);
      // The live strip it fed is gone from the clinician's laptop, so there is nothing
      // on the other end to draw it. The /live route stays for a future console.
      void liveOn;
      if (faceOn.current) send({ type: "face", seen: got.face, t: now() });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [post, tracker]);

  useEffect(() => {
    stepRef.current = step?.id ?? (slot?.kind ?? "setup");
    liveOn.current = mediaState === "ready" && !state.stopped;
    // Only watch for a lost face when there is a landmarker to lose it with. Without one
    // every frame says "no face" and the call would pause forever.
    faceOn.current = tracker.ready && phase === "task" && !state.paused && !!step && WATCHED.includes(step.task);
  }, [mediaState, phase, slot, state.paused, state.stopped, step, tracker]);

  /* ---- pause when the page goes away ---- */

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && phase === "task") {
        voice.stop();
        send({ type: "pause", why: "hidden" });
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [phase, voice]);

  /* ---- a calm banner when the network is struggling ---- */

  useEffect(() => {
    const text = prefs.pending > 2 ? "Your connection is slow, so your measurements are waiting to send. Carry on as normal." : "";
    if (text !== prefs.banner) useCallStore.getState().setBanner(text);
  }, [prefs.banner, prefs.pending]);

  /* ---- what a task is allowed to do ---- */

  const recorder = useMemo(
    () => ({
      start: () => recorderRef.current?.start() ?? false,
      stop: () => recorderRef.current?.stop() ?? Promise.resolve(null),
    }),
    [],
  );

  const done = useCallback(() => {
    voice.stop();
    setPhase("intro");
    send({ type: "next" });
  }, [voice]);

  const ctx: CallCtx = useMemo(
    () => ({
      script,
      stim,
      post,
      tracker,
      voice,
      recorder,
      setTarget: (p) => {
        target.current = p;
      },
      done,
      skip: (ids) => send({ type: "skip", ids }),
      stop: (say, audio) => {
        voice.stop();
        send({ type: "stop", say, audio });
      },
    }),
    [done, post, recorder, script, stim, tracker, voice],
  );

  /* ---- stopping on purpose ---- */

  const quit = useCallback(async () => {
    voice.stop();
    tracker.record(false);
    setLeaving("going");
    try {
      await post.finish(true);
    } catch {
      // The finish post may not land. The clinic still sees an unfinished session.
    }
    setLeaving("told");
  }, [post, tracker, voice]);

  /* ---- render ---- */

  const ending = state.stopped || leaving === "told" || leaving === "going";

  let body = null;
  if (state.stopped) {
    body = <EmergencyStage say={state.stopSay} audio={state.stopAudio} />;
  } else if (leaving === "going") {
    body = <Stage title="One moment" caption="Letting your care team know you stopped." />;
  } else if (leaving === "told") {
    body = <StoppedStage told />;
  } else if (!slot) {
    body = <Stage title="Thank you" caption="The check-in is finished. You can close this page." />;
  } else if (slot.kind === "consent") {
    body = <ConsentStage onDone={() => send({ type: "next" })} />;
  } else if (slot.kind === "setup") {
    body = (
      <SetupStage
        state={mediaState}
        error={mediaError}
        stream={stream}
        lights={lights}
        modelReason={modelReason}
        onAsk={() => void ask()}
        onDone={() => send({ type: "next" })}
        onTellClinic={() => void quit()}
        onNoCamera={() => {
          setModelReason("the camera could not be used on this phone");
          send({ type: "skip", ids: eyeStepIds(script) });
          send({ type: "next" });
        }}
      />
    );
  } else if (step && phase === "intro") {
    body = (
      <StepIntro
        step={step}
        script={script}
        onStart={() => {
          if (spokenOnly(step.task)) {
            send({ type: "next" });
            return;
          }
          setPhase("task");
        }}
      />
    );
  } else if (step && !state.paused) {
    body = <TaskView key={`${step.id}-${state.attempt}`} step={step} onDone={done} />;
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-screen bg-background" style={contrastVars(prefs.contrast)}>
        {!ending && (
          <Chrome
            progress={progress(state)}
            minutes={minutesLeft(state)}
            paused={state.paused}
            onPause={() => {
              voice.stop();
              send({ type: "pause", why: "patient" });
            }}
            onResume={() => send({ type: "resume" })}
            onStop={() => setLeaving("ask")}
          />
        )}
        <Banner text={prefs.banner} />
        {body}
        {state.paused && state.why && !ending && (
          <PausedOverlay reason={state.why} onResume={() => send({ type: "resume" })} onStop={() => setLeaving("ask")} />
        )}
        {leaving === "ask" && (
          <div
            className="fixed inset-0 z-[80] flex items-end bg-black/45 px-4 pb-6"
            role="dialog"
            aria-label="Stop the check-in"
          >
            <div className="w-full rounded-[1.25rem] border border-border bg-card p-5">
              <h2 className="text-base font-extrabold">Stop and contact my clinic</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This ends the check-in and tells your care team you stopped. Nothing you have done so far is lost.
              </p>
              <div className="mt-5 space-y-3">
                <Big tone="danger" onClick={() => void quit()}>
                  Yes, stop and tell my clinic
                </Big>
                <Big tone="outline" onClick={() => setLeaving("")}>
                  Go back to the check-in
                </Big>
              </div>
            </div>
          </div>
        )}
        {/* The landmarker reads this element. It is never recorded, shown or sent. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-hidden
          className="pointer-events-none fixed bottom-0 right-0 h-[2px] w-[2px] opacity-[0.01]"
        />
      </div>
    </Ctx.Provider>
  );
}
