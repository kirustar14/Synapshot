// The tasks where the patient taps an answer: the red flag screen, the symptom scores and
// the word list.
//
// The red flag screen is the one place in the product where the page must not think. It
// collects seven yes or no answers, posts them, and does exactly what comes back. If the
// post fails it stops and says so rather than carrying on, because carrying on would mean
// running a fourteen minute test on someone who might need an ambulance.

import { useEffect, useRef, useState } from "react";
import { useCall } from "./ctx";
import { useSpokenLine } from "./voice";
import { Big, NumberPicker, Replay, Stage } from "./ui";
import { num, strings } from "./types";
import type { TaskProps } from "./types";

/** The keys the backend expects, used when the script did not list them in params. */
const REDFLAG_KEYS = [
  "worsening_headache",
  "repeated_vomiting",
  "seizure",
  "increasing_confusion",
  "new_weakness_or_numbness",
  "slurred_speech",
  "unusual_drowsiness",
];

/** Plain language names for the symptom keys the backend scores. */
const SYMPTOM_LABELS: Record<string, string> = {
  headache: "Headache",
  pressure: "Pressure in your head",
  neck_pain: "Neck pain",
  nausea: "Feeling sick",
  dizziness: "Dizziness",
  blurred_vision: "Blurred vision",
  light_sensitivity: "Light hurting your eyes",
  noise_sensitivity: "Noise bothering you",
  fatigue: "Tiredness",
  concentration: "Trouble concentrating",
  slowed: "Feeling slowed down",
};

function label(key: string): string {
  return SYMPTOM_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ---------------------------------------------------------------- red flags */

/** Seven safety questions, one per screen, big yes and no. The backend decides. */
export function RedflagsTask({ step, onDone }: TaskProps) {
  const { script, post, voice, stop } = useCall();
  const keys = strings(step.params, "items");
  const order = keys.length === script.redflag_items.length && keys.length ? keys : REDFLAG_KEYS;
  const asks = script.redflag_items.length ? script.redflag_items : order.map(label);
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [cleared, setCleared] = useState("");
  const [failed, setFailed] = useState("");

  // One question at a time, keyed on which one. Moving to the next cuts the last one
  // off in the player rather than starting a second line over it, which is what made
  // all seven safety questions read at once.
  const ask = useSpokenLine(
    voice,
    at < asks.length ? `redflag:${order[at]}` : "",
    at < asks.length ? asks[at] : "",
    at < asks.length ? `redflag_${order[at]}.mp3` : undefined,
  );

  async function send(all: Record<string, boolean>) {
    setSending(true);
    setFailed("");
    try {
      const result = await post.redflags(all);
      if (result.stop) {
        stop(result.say, result.audio);
        return;
      }
      setCleared(result.say);
      await voice.say(result.say, result.audio);
      onDone();
    } catch {
      setFailed("I could not reach your clinic's system to check those answers. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function answer(yes: boolean) {
    const all = { ...answers, [order[at]]: yes };
    setAnswers(all);
    if (at + 1 < asks.length) {
      setAt(at + 1);
      return;
    }
    void send(all);
  }

  if (cleared) return <Stage title="Thank you" caption={cleared} />;
  if (sending) {
    return <Stage title="One moment" caption="Checking those answers with your clinic's system." />;
  }
  if (failed) {
    return (
      <Stage
        title="That did not go through"
        caption={failed}
        footer={<Big onClick={() => void send(answers)}>Try again</Big>}
      />
    );
  }

  return (
    <Stage title={`Safety question ${at + 1} of ${asks.length}`} caption={asks[at]}>
      <div className="mt-6 space-y-3">
        <Replay onClick={ask.replay} speaking={ask.speaking} />
        <Big tone="outline" onClick={() => answer(true)}>
          Yes
        </Big>
        <Big tone="outline" onClick={() => answer(false)}>
          No
        </Big>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Answer honestly. If any answer means you need help now, the check-in stops here and tells you what to do.
      </p>
    </Stage>
  );
}

/* ---------------------------------------------------------------- symptoms */

/** A big number picker per item, one item per screen, then post and obey the skip list. */
export function SymptomsTask({ step, onDone }: TaskProps) {
  const { script, post, voice, skip } = useCall();
  const listed = strings(step.params, "items");
  const items = listed.length ? listed : script.symptom_items;
  const phase: "baseline" | "rerate" = step.id === "symptoms_rerate" ? "rerate" : "baseline";
  const [at, setAt] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState("");

  // Same as the safety questions: one symptom at a time, keyed on which one.
  const ask = useSpokenLine(
    voice,
    at < items.length ? `symptom:${items[at]}` : "",
    at < items.length ? `${label(items[at])}. Zero to ten.` : "",
    at < items.length ? `symptom_${items[at]}.mp3` : undefined,
  );

  async function send(all: Record<string, number>) {
    setSending(true);
    setFailed("");
    try {
      const result = await post.symptoms(all, phase);
      if (result.skip?.length) skip(result.skip);
      onDone();
    } catch {
      setFailed("I could not send those scores. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function choose(value: number) {
    const all = { ...scores, [items[at]]: value };
    setScores(all);
    if (at + 1 < items.length) {
      setAt(at + 1);
      return;
    }
    void send(all);
  }

  if (sending) return <Stage title="Thank you" caption="Saving your answers." />;
  if (failed) {
    return <Stage title="That did not go through" caption={failed} footer={<Big onClick={() => void send(scores)}>Try again</Big>} />;
  }

  const key = items[at];
  return (
    <Stage title={label(key)} caption={`How bad has this been this week? ${at + 1} of ${items.length}`}>
      <div className="mt-4">
        <Replay onClick={ask.replay} speaking={ask.speaking} />
        <NumberPicker value={scores[key] ?? null} onChange={choose} label={label(key)} />
      </div>
      <div className="mt-3 flex justify-between text-xs text-muted-foreground">
        <span>0, none at all</span>
        <span>10, the worst you can imagine</span>
      </div>
      {at > 0 && (
        <button
          type="button"
          onClick={() => setAt(at - 1)}
          className="mt-6 inline-flex h-12 items-center text-sm font-bold text-primary"
        >
          Back to the one before
        </button>
      )}
    </Stage>
  );
}

/* ---------------------------------------------------------------- word list */

/** Fifteen words, one at a time, spoken and shown. */
export function EncodeTask({ step, onDone }: TaskProps) {
  const { script, voice } = useCall();
  const words = script.words.length ? script.words : [];
  const hold = num(step.params, "word_ms", 2000);
  const [at, setAt] = useState(0);
  const timer = useRef(0);

  useEffect(() => {
    if (!words.length) {
      onDone();
      return;
    }
    if (at >= words.length) {
      onDone();
      return;
    }
    // The next word waits for this one to finish, then for the gap. It used to be a
    // flat timer, so a word that ran longer than the gap was still being said when the
    // next one started and the patient heard two words at once, which is the one thing
    // a memory list cannot survive.
    let live = true;
    void voice.say(words[at], undefined).then((finished) => {
      // A word that was cut off does not advance the list. Otherwise stopping the call
      // mid word would still march through the remaining fourteen.
      if (!live || !finished) return;
      timer.current = window.setTimeout(() => {
        if (live) setAt(at + 1);
      }, hold);
    });
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
  }, [at, hold, onDone, voice, words]);

  if (at >= words.length) return <Stage title="Thank you" caption="I will ask for those words again later." />;

  return (
    <Stage caption="Read each word out loud and try to remember it.">
      <div className="flex min-h-[220px] items-center justify-center">
        <p className="text-4xl font-extrabold tracking-tight">{words[at]}</p>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {at + 1} of {words.length}
      </p>
    </Stage>
  );
}
