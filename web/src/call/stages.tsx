// The stages that are not tasks: consent, permissions and setup, the spoken introduction to
// each step, the emergency screen, the stopped screen and the wrap up.

import { AlertTriangle, Check, Phone, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CallScript, CallStatus, ScriptStep } from "@/api/types";
import type { ConsentChoices } from "@/api/client";
import { cn } from "@/lib/utils";
import { useCall } from "./ctx";
import { Big, LightRow, SelfView, Stage } from "./ui";
import type { Lights } from "./types";

/* ---------------------------------------------------------------- consent */

interface Toggle {
  key: keyof ConsentChoices;
  label: string;
  note: string;
}

const TOGGLES: Toggle[] = [
  {
    key: "calls",
    label: "I agree to these weekly check-ins",
    note: "About fourteen minutes, once a week, on this phone. You can stop any one of them at any point.",
  },
  {
    key: "ai",
    label: "I understand this assistant is software",
    note: "It is software, not a person. It measures and reports. Your clinician reads the results and makes every decision.",
  },
  {
    key: "recording",
    label: "I agree to the recording this needs",
    note: "Your video never leaves this phone. Only the measurements leave. For the speaking tasks the audio recording is uploaded so it can be measured.",
  },
  {
    key: "genetic",
    label: "Optional: my genetic data may be used",
    note: "Separate and off unless you turn it on. Only four specific markers are read, and they change the healing estimate and how uncertain it is, nothing else.",
  },
];

/** Reusable consent panel, shared by the call page and the standalone consent page. */
export function ConsentForm({
  text,
  choices,
  onChange,
  onRead,
}: {
  text: string[];
  choices: ConsentChoices;
  onChange: (c: ConsentChoices) => void;
  onRead?: () => void;
}) {
  return (
    <>
      <div className="space-y-3 text-sm leading-relaxed">
        {text.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className="mt-4 inline-flex h-12 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-bold"
        >
          <Volume2 className="h-4 w-4" aria-hidden /> Read this to me
        </button>
      )}
      <ul className="mt-6 space-y-3">
        {TOGGLES.map((row) => {
          const on = choices[row.key];
          return (
            <li key={row.key}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onChange({ ...choices, [row.key]: !on })}
                className={cn(
                  "flex min-h-[64px] w-full items-start gap-3 rounded-2xl border p-4 text-left",
                  on ? "border-primary bg-primary-soft" : "border-border bg-card",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on ? <Check className="h-4 w-4" aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{row.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{row.note}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export const EMPTY_CONSENT: ConsentChoices = { calls: false, ai: false, recording: false, genetic: false };

/** True when the three required boxes are ticked. Nothing runs without all three. */
export function consentReady(c: ConsentChoices): boolean {
  return c.calls && c.ai && c.recording;
}

/** The consent stage of the call. Posts the choices, then hands over to setup. */
export function ConsentStage({ onDone }: { onDone: () => void }) {
  const { script, post, voice } = useCall();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState("");

  async function accept() {
    voice.prime();
    setSending(true);
    setFailed("");
    try {
      await post.consent(choices);
      onDone();
    } catch {
      setFailed("I could not save that. Check your signal and try again.");
    } finally {
      setSending(false);
    }
  }

  function readAloud() {
    voice.prime();
    void (async () => {
      for (let i = 0; i < script.consent.length; i += 1) {
        await voice.say(script.consent[i], `consent_${i + 1}.mp3`);
      }
    })();
  }

  return (
    <Stage title="Before we start" footer={<></>}>
      <ConsentForm text={script.consent} choices={choices} onChange={setChoices} onRead={readAloud} />
      {failed && <p className="mt-4 text-sm text-destructive">{failed}</p>}
      <div className="mt-6 space-y-3">
        <Big onClick={() => void accept()} disabled={!consentReady(choices) || sending}>
          {sending ? "Saving" : "I agree, start the check-in"}
        </Big>
        {!consentReady(choices) && (
          <p className="text-center text-xs text-muted-foreground">
            The first three are needed before anything can run.
          </p>
        )}
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- setup */

export type MediaState = "idle" | "asking" | "ready" | "denied";

/** Permissions, the self view, and the four green ticks. */
export function SetupStage({
  state,
  error,
  stream,
  lights,
  modelReason,
  onAsk,
  onDone,
  onTellClinic,
  onNoCamera,
}: {
  state: MediaState;
  error: string;
  stream: MediaStream | null;
  lights: Lights;
  modelReason: string;
  onAsk: () => void;
  onDone: () => void;
  onTellClinic: () => void;
  onNoCamera: () => void;
}) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setWaited(true), 20000);
    return () => window.clearTimeout(id);
  }, []);

  if (state === "idle" || state === "asking") {
    return (
      <Stage
        title="Set your phone up"
        caption="Next your phone will ask to use the camera and the microphone. Both are needed for the measurements."
        footer={
          <Big onClick={onAsk} disabled={state === "asking"}>
            {state === "asking" ? "Waiting for your answer" : "Allow camera and microphone"}
          </Big>
        }
      >
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li>Prop the phone up against something, at about eye level.</li>
          <li>Sit an arm's length away, with the light on your face rather than behind you.</li>
          <li>Take your glasses off if they glare, if you can still see the screen comfortably.</li>
          <li>Find somewhere quiet, because part of this listens to your voice.</li>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Your video stays on this phone. The phone works out the measurements and sends only those numbers.
        </p>
      </Stage>
    );
  }

  if (state === "denied") {
    return (
      <Stage
        title="The camera is blocked"
        caption={error}
        footer={
          <>
            <Big onClick={onAsk}>Try again</Big>
            <Big tone="outline" onClick={onNoCamera}>
              Carry on without the camera
            </Big>
            <Big tone="outline" onClick={onTellClinic}>
              Tell my clinic I could not do this
            </Big>
          </>
        }
      >
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          On an iPhone, tap the double A in the address bar, then Website Settings, then set Camera and Microphone to
          Allow, and reload this page.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Carrying on without the camera skips the eye parts. The speaking and memory parts still run, and your
          clinician will see that the eye parts were not done.
        </p>
      </Stage>
    );
  }

  const good = lights.face && lights.light;
  return (
    <Stage title="Let me check I can see you" caption="Line your face up inside the oval and hold still for a moment.">
      <div className="mt-4 grid grid-cols-[136px_1fr] gap-4">
        <SelfView stream={stream} lights={lights} />
        <LightRow lights={lights} />
      </div>
      {modelReason && (
        <div className="mt-5 rounded-2xl border border-synthetic/40 bg-synthetic-soft p-4 text-xs leading-relaxed">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-synthetic-foreground" aria-hidden />
          The eye measurement is not available on this call, because {modelReason}. The speaking and memory parts still
          run and your clinician will see those. You do not need to do anything.
        </div>
      )}
      <div className="mt-5 space-y-3">
        <Big onClick={onDone} disabled={!good && !waited}>
          {good ? "I am ready" : "Waiting for the camera"}
        </Big>
        {!good && waited && (
          <p className="text-center text-xs text-muted-foreground">
            If the ticks will not go green, carry on anyway. Your clinician will see that the picture was poor.
          </p>
        )}
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- step introduction */

/** The spoken line for one step, shown as a caption, with one tap to begin. */
export function StepIntro({ step, script, onStart }: { step: ScriptStep; script: CallScript; onStart: () => void }) {
  const { voice, post } = useCall();
  const spoken = useRef("");

  useEffect(() => {
    if (spoken.current === step.id) return;
    spoken.current = step.id;
    post.line(step.id, step.say);
    void voice.say(step.say, step.audio);
  }, [post, step, voice]);

  const warnFlash = step.task === "quality";
  return (
    <Stage title={TITLES[step.task] ?? "Next"} caption={step.say} footer={<Big onClick={onStart}>I am ready</Big>}>
      {warnFlash && (
        <p className="mt-4 rounded-2xl border border-border bg-muted p-4 text-xs leading-relaxed">
          This part flashes the screen white ten times, about a second and a half apart. It is how the phone works out
          how far behind the camera is. If bright light is painful right now, pause and try again later.
        </p>
      )}
      {step.task === "recall" && script.words.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">There were fifteen words. Any order is fine.</p>
      )}
    </Stage>
  );
}

const TITLES: Record<string, string> = {
  redflags: "Safety questions",
  quality: "Camera check",
  calib: "Nine dots",
  symptoms: "How you have felt",
  encode: "Fifteen words",
  pursuit_h: "Follow the dot",
  pursuit_v: "Follow the dot",
  saccade: "Look at the dot",
  antisaccade: "Look the other way",
  fixation: "Hold still",
  npc: "Number card",
  speech_ah: "Say ahhh",
  speech_pataka: "Pa ta ka",
  speech_passage: "Read out loud",
  picture: "A picture",
  fluency: "Name animals",
  recall: "The words from earlier",
  wrap: "Almost done",
  none: "Next",
};

/* ---------------------------------------------------------------- endings */

/** The emergency screen. The wording and the audio both come from the backend. */
export function EmergencyStage({ say, audio }: { say: string; audio: string }) {
  const { voice } = useCall();
  useEffect(() => {
    void voice.say(say, audio || undefined);
  }, [audio, say, voice]);

  return (
    <div className="mx-auto w-full max-w-[520px] px-5 pb-10 pt-[88px]">
      <div className="rounded-2xl border border-destructive/40 bg-destructive-soft p-5">
        <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden />
        <h1 className="mt-3 text-xl font-extrabold">Please get help now</h1>
        <p className="mt-3 text-[15px] leading-relaxed">{say}</p>
      </div>
      <a
        href="tel:911"
        className="mt-5 inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-destructive px-6 text-base font-bold text-destructive-foreground"
      >
        <Phone className="h-5 w-5" aria-hidden /> Call emergency services
      </a>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        If that number is not the emergency number where you are, dial your local one. The check-in has ended and your
        care team has been told.
      </p>
    </div>
  );
}

/** The screen after the patient chooses to stop. */
export function StoppedStage({ told }: { told: boolean }) {
  return (
    <Stage title="Check-in stopped">
      <p className="mt-2 text-sm leading-relaxed">
        {told
          ? "Your care team has been told you stopped, and they will be in touch. Nothing else is needed from you now."
          : "We are letting your care team know."}
      </p>
      <p className="mt-4 text-sm leading-relaxed">
        If you want to talk to someone, reply to the text message that sent you this link, or call your clinic on the
        number they gave you. If you feel worse at any time, call your local emergency number.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">You can close this page.</p>
    </Stage>
  );
}

/** The wrap screen: finish the call, poll until the summary is ready, then show it. */
export function WrapStage() {
  const { post, voice } = useCall();
  const [state, setState] = useState<CallStatus["state"]>("processing");
  const [summary, setSummary] = useState("");
  const finished = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      // The finish post goes out once. The polling loop belongs to this mount, so it is
      // the loop that stops on unmount, not the whole effect.
      if (!finished.current) {
        finished.current = true;
        try {
          await post.finish(false);
        } catch {
          if (live) setState("failed");
        }
      }
      while (live) {
        try {
          const status = await post.status();
          if (!live) return;
          setState(status.state);
          if (status.summary) setSummary(status.summary);
          if (status.state === "done" || status.state === "failed") return;
        } catch {
          // A missed poll is nothing. Try again in a moment.
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();
    return () => {
      live = false;
    };
  }, [post]);

  useEffect(() => {
    if (summary) void voice.say(summary, undefined);
  }, [summary, voice]);

  return (
    <Stage title="Thank you">
      {state !== "done" && state !== "failed" && (
        <>
          <p className="mt-2 text-sm leading-relaxed">
            That is everything. Your answers are being worked through now, which takes a few seconds.
          </p>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </>
      )}
      {state === "done" && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] leading-relaxed">
            {summary ||
              "Your check-in is complete and your care team has the results. They will contact you if anything needs attention."}
          </p>
        </div>
      )}
      {state === "failed" && (
        <p className="mt-4 text-sm leading-relaxed">
          Your answers were saved, but the summary could not be put together just now. Your care team can still see
          everything. Nothing more is needed from you.
        </p>
      )}
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Nothing here is a diagnosis and nothing here replaces your doctor. If you feel worse at any time, call your
        clinic or your local emergency number. You can close this page now.
      </p>
    </Stage>
  );
}
