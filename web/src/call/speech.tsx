// The tasks where the patient talks: ahhh, pa-ta-ka, the passage, the picture, animal
// fluency, the word recall and the near point card.
//
// Audio is the only raw media that leaves the phone, and it only leaves during these tasks.
// Recording starts when the task opens and stops either when the timer runs out or when the
// patient says they have finished, then the clip is handed to the buffered uploader so a
// weak signal delays it rather than losing it.

import { Mic } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useCall } from "./ctx";
import { Kitchen } from "./kitchen";
import { useMeasured } from "./measure";
import { Big, Stage } from "./ui";
import { num } from "./types";
import type { TaskProps } from "./types";

/** A ring that empties as the time runs down. */
function Ring({ left, total }: { left: number; total: number }) {
  const share = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const circumference = 2 * Math.PI * 26;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 60 60" className="h-14 w-14 shrink-0" aria-hidden>
        <circle cx="30" cy="30" r="26" fill="none" stroke="var(--muted)" strokeWidth="5" />
        <circle
          cx="30"
          cy="30"
          r="26"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * share} ${circumference}`}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <p className="text-sm font-bold" aria-live="off">
        <Mic className="mr-1 inline h-4 w-4 text-destructive" aria-hidden />
        recording, {Math.ceil(left)} seconds left
      </p>
    </div>
  );
}

interface RecordProps extends TaskProps {
  title: string;
  prompt: string;
  seconds: number;
  /** What the patient looks at while they talk. */
  body?: ReactNode;
  /** True when the task has to run the whole clock, like the fluency minute. */
  fixed?: boolean;
}

/** Records one task's audio and uploads it. Shared by every speaking task. */
export function RecordTask({ step, onDone, title, prompt, seconds, body, fixed }: RecordProps) {
  const { post, recorder } = useCall();
  const [left, setLeft] = useState(seconds);
  const [live, setLive] = useState(false);
  const closing = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    if (!recorder || opened.current) return;
    opened.current = true;
    setLive(recorder.start());
  }, [recorder]);

  useEffect(() => {
    const id = window.setInterval(() => setLeft((v) => Math.max(0, v - 0.25)), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (left > 0 || closing.current) return;
    void stop();
  }, [left]);

  async function stop() {
    closing.current = true;
    const clip = recorder ? await recorder.stop() : null;
    if (clip) post.audio(step.id, clip.blob, clip.ext);
    onDone();
  }

  return (
    <Stage
      title={title}
      caption={prompt}
      footer={
        <>
          {live ? <Ring left={left} total={seconds} /> : null}
          {!live && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              This phone would not let the page record sound, so this part is not measured. Everything else still works.
            </p>
          )}
          {(!fixed || !live) && (
            <Big tone="outline" onClick={() => void stop()}>
              I have finished
            </Big>
          )}
        </>
      }
    >
      {body}
    </Stage>
  );
}

/* ---------------------------------------------------------------- the simple ones */

/** Say ahhh in one steady note. */
export function AhTask(props: TaskProps) {
  return (
    <RecordTask
      {...props}
      title="Say ahhh"
      prompt="Take a breath and say ahhh in one steady note, for as long as you comfortably can."
      seconds={num(props.step.params, "seconds", 25)}
    />
  );
}

/** Pa ta ka, as fast and as clearly as possible. */
export function PatakaTask(props: TaskProps) {
  return (
    <RecordTask
      {...props}
      title="Pa ta ka"
      prompt="Say pa ta ka over and over, as fast as you can and as clearly as you can."
      seconds={num(props.step.params, "seconds", 15)}
      body={<p className="mt-6 text-center text-3xl font-extrabold tracking-wide">pa ta ka</p>}
    />
  );
}

/** Read the passage at a normal pace. */
export function PassageTask(props: TaskProps) {
  const { script } = useCall();
  const passage = typeof props.step.params.passage === "string" ? (props.step.params.passage as string) : script.passage;
  return (
    <RecordTask
      {...props}
      title="Read this out loud"
      prompt="Read it at your normal speed. If you lose your place, start the sentence again."
      seconds={num(props.step.params, "seconds", 45)}
      body={<p className="mt-4 text-lg leading-relaxed">{passage}</p>}
    />
  );
}

/** Name as many animals as possible in the given time. */
export function FluencyTask(props: TaskProps) {
  const { script } = useCall();
  const seconds = num(props.step.params, "seconds", script.fluency_seconds || 60);
  return (
    <RecordTask
      {...props}
      title="Name animals"
      prompt="Say as many different animals as you can, out loud, until the time runs out."
      seconds={seconds}
      fixed
    />
  );
}

/** Say back as many of the fifteen words as possible. */
export function RecallTask(props: TaskProps) {
  return (
    <RecordTask
      {...props}
      title="The words from earlier"
      prompt="Say as many of the fifteen words as you can remember, out loud, in any order."
      seconds={num(props.step.params, "seconds", 45)}
    />
  );
}

/* ---------------------------------------------------------------- picture */

/** Describe the kitchen scene. This one also records frames, so it marks its task. */
export function PictureTask(props: TaskProps) {
  const { finish } = useMeasured("picture", props.step.params);
  const seconds = num(props.step.params, "seconds", 60);
  return (
    <RecordTask
      {...props}
      onDone={() => {
        finish();
        props.onDone();
      }}
      title="Tell me about this picture"
      prompt="Describe everything you can see happening, in as much detail as you like."
      seconds={seconds}
      body={
        <div className="mt-4">
          <Kitchen />
        </div>
      }
      fixed
    />
  );
}

/* ---------------------------------------------------------------- near point */

const CARD_STEPS = [40, 34, 28, 22, 17, 13, 10, 8, 6];

/** Number cards drawn in code, growing as if coming closer, until they go double. */
export function NpcTask({ step, onDone }: TaskProps) {
  const { post, recorder, stim } = useCall();
  const maxCm = num(step.params, "max_cm", 30);
  const [at, setAt] = useState(0);
  const [live, setLive] = useState(false);
  const closing = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    if (!recorder || opened.current) return;
    opened.current = true;
    setLive(recorder.start());
  }, [recorder]);

  useEffect(() => {
    const id = window.setInterval(() => setAt((v) => Math.min(CARD_STEPS.length - 1, v + 1)), 1400);
    return () => window.clearInterval(id);
  }, []);

  async function stop(broke: boolean) {
    if (closing.current) return;
    closing.current = true;
    const cm = Math.round((maxCm * (CARD_STEPS.length - at)) / CARD_STEPS.length);
    stim.note("npc_double", broke ? Math.max(0, Math.min(1, cm / Math.max(1, maxCm))) : 1);
    // The distance in centimetres is the measurement here, so it goes to the answer
    // route. Without this the pipeline reads nothing for npc_cm. A patient who never
    // saw it go double reports the full distance, which is the normal result.
    post.answer("npc_cm", broke ? cm : maxCm);
    const clip = recorder ? await recorder.stop() : null;
    if (clip) post.audio(step.id, clip.blob, clip.ext);
    onDone();
  }

  const size = CARD_STEPS[at];
  return (
    <Stage
      title="Read the numbers out loud"
      caption="Read each number as the card gets bigger. Tap the button the moment the numbers go double or blurry."
      footer={
        <>
          {live && (
            <p className="text-xs text-muted-foreground">
              <Mic className="mr-1 inline h-3 w-3 text-destructive" aria-hidden /> recording your voice
            </p>
          )}
          <Big onClick={() => void stop(true)}>They went double</Big>
          <Big tone="outline" onClick={() => void stop(false)}>
            They stayed clear
          </Big>
        </>
      }
    >
      <div className="mt-6 flex min-h-[200px] items-center justify-center">
        <p className="font-mono font-bold tabular-nums" style={{ fontSize: `${72 - size}px`, lineHeight: 1.1 }}>
          {["4 7 2", "9 3 6", "5 8 1", "2 6 9", "7 1 4", "3 9 5", "8 2 7", "6 4 3", "1 5 8"][at]}
        </p>
      </div>
    </Stage>
  );
}
