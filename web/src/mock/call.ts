// The web call script the patient call page walks through, plus the voice line inventory the
// demo console shows. Mirrors what the backend returns from /api/call/{token}/script.

import type { CallScript, ScriptStep, VoiceLine, Voices } from "@/api/types";
import { hashStr, round, rng } from "./rng";

const CONSENT = [
  "Your clinic would like to check in with you once a week by video call. Each call takes about ten minutes and you can stop at any point.",
  "This assistant is software, not a person. It speaks to you, asks you to follow a dot with your eyes, read a short passage, remember some words, and answer questions about how you feel.",
  "Your video never leaves this phone. Only measurements leave, such as how far your eyes moved and how quickly you spoke. For the speaking tasks the audio recording is uploaded so your care team can review it.",
  "A person on your care team reads the results. Nothing here is a diagnosis and nothing here replaces your doctor. If you feel worse at any time, call your clinic or your local emergency number.",
  "You can also choose, separately, whether your genetic data may be used. That choice is optional and off by default.",
];

const REDFLAG_ITEMS = [
  "Has your headache become much worse in the last day?",
  "Have you vomited more than once since your injury?",
  "Have you had a seizure or shaking you could not control?",
  "Is one side of your body weak, numb, or hard to move?",
  "Has your speech become slurred or hard to understand?",
  "Are you much more sleepy than usual, or hard to wake?",
  "Is clear fluid or blood coming from your nose or ears?",
];

const SYMPTOM_ITEMS = [
  "Headache",
  "Pressure in the head",
  "Dizziness",
  "Sensitivity to light",
  "Sensitivity to noise",
  "Feeling slowed down",
  "Difficulty concentrating",
  "Fatigue or low energy",
];

const WORDS = [
  "apple", "river", "candle", "garden", "button",
  "copper", "window", "saddle", "meadow", "lantern",
  "harbour", "pebble", "thunder", "ribbon", "cellar",
];

const PASSAGE =
  "The river ran quietly past the old mill, turning the wheel that had ground flour for a hundred years. " +
  "Every morning the baker walked down the lane with an empty sack and walked back with a full one. " +
  "In winter the water slowed, and in spring it rose high enough to touch the lowest stone.";

interface StepSeed {
  id: string;
  say: string;
  task: ScriptStep["task"];
  minutes: number;
  tier: ScriptStep["tier"];
  block?: "A" | "B";
  params?: Record<string, unknown>;
}

const STEP_SEEDS: StepSeed[] = [
  { id: "intro", say: "Hello. This is your weekly check-in. I am software, not a person. We will take about ten minutes together, and you can stop whenever you want.", task: "none", minutes: 0.4, tier: "none" },
  { id: "redflags", say: "First, seven quick safety questions. Please answer yes or no.", task: "redflags", minutes: 1.2, tier: "safety", params: { items: REDFLAG_ITEMS } },
  { id: "quality", say: "Now let us check the picture and the light. Please prop the phone up and look straight at it.", task: "quality", minutes: 0.8, tier: "gate", params: { flashes: 10, min_fps: 20, min_iris_px: 9 } },
  { id: "calib", say: "Look at each dot as it appears, and try to keep your head still.", task: "calib", minutes: 0.6, tier: "gate", params: { dots: 9, hold_ms: 1000 } },
  { id: "symptoms", say: "How have you felt this week? For each one, pick a number from zero to ten.", task: "symptoms", minutes: 1.4, tier: "A", params: { items: SYMPTOM_ITEMS, scale: 10, phase: "main" } },
  { id: "encode", say: "I will read fifteen words. Just listen and try to remember them. I will ask for them later.", task: "encode", minutes: 1.1, tier: "A", block: "A", params: { words: WORDS, word_ms: 1600 } },
  { id: "pursuit_h", say: "Follow the dot with your eyes as it moves side to side. Keep your head still.", task: "pursuit_h", minutes: 0.5, tier: "A", block: "A", params: { hz: 0.4, amp: 0.35, seconds: 20 } },
  { id: "pursuit_v", say: "Now follow the dot as it moves up and down.", task: "pursuit_v", minutes: 0.5, tier: "A", block: "A", params: { hz: 0.4, amp: 0.3, seconds: 20 } },
  { id: "saccade", say: "Look at the dot as soon as it jumps. There will be a brief flash before each one.", task: "saccade", minutes: 0.7, tier: "B", block: "B", params: { trials: 20, flash: true, ecc: 0.3 } },
  { id: "antisaccade", say: "This time, when the dot appears, look the other way instead.", task: "antisaccade", minutes: 0.7, tier: "B", block: "B", params: { trials: 20, ecc: 0.3 } },
  { id: "fixation", say: "Look at the centre dot and hold still for ten seconds.", task: "fixation", minutes: 0.3, tier: "A", block: "A", params: { seconds: 10 } },
  { id: "npc", say: "Read the numbers out loud as the card moves closer, and tell me when they go double.", task: "npc", minutes: 0.6, tier: "B", block: "B", params: { cards: 6, record: true } },
  { id: "speech_ah", say: "Take a breath and say ahhh for as long as you comfortably can.", task: "speech_ah", minutes: 0.4, tier: "A", block: "A", params: { seconds: 15, record: true } },
  { id: "speech_pataka", say: "Now say pa ta ka, over and over, as quickly and clearly as you can.", task: "speech_pataka", minutes: 0.4, tier: "A", block: "A", params: { seconds: 10, record: true } },
  { id: "speech_passage", say: "Please read this passage out loud at your normal pace.", task: "speech_passage", minutes: 0.9, tier: "A", block: "A", params: { passage: PASSAGE, record: true } },
  { id: "picture", say: "Tell me everything you can see happening in this picture.", task: "picture", minutes: 1.1, tier: "B", block: "B", params: { picture: "kitchen", seconds: 60, record: true } },
  { id: "fluency", say: "Name as many animals as you can. Ready, go.", task: "fluency", minutes: 0.8, tier: "B", block: "B", params: { category: "animals", seconds: 60, record: true } },
  { id: "recall", say: "Now tell me all the words you can remember from the list earlier.", task: "recall", minutes: 0.8, tier: "A", block: "A", params: { words: WORDS, seconds: 60, record: true } },
  { id: "wrap", say: "That is everything. Thank you for your time. Your care team will see today's results.", task: "wrap", minutes: 0.4, tier: "none" },
];

function toStep(seed: StepSeed): ScriptStep {
  return {
    id: seed.id,
    say: seed.say,
    audio: `${seed.id}.mp3`,
    task: seed.task,
    minutes: seed.minutes,
    tier: seed.tier,
    ...(seed.block ? { block: seed.block } : {}),
    params: seed.params ?? {},
  };
}

/** The full call script. Identical for every mock token, so the page is easy to replay. */
export function callScript(): CallScript {
  return {
    consent: CONSENT,
    steps: STEP_SEEDS.map(toStep),
    voice_base: "/voice/",
    symptom_items: SYMPTOM_ITEMS,
    redflag_items: REDFLAG_ITEMS,
    words: WORDS,
    passage: PASSAGE,
    picture: "kitchen",
    fluency_seconds: 60,
  };
}

/** Voice inventory for the demo console. Mock mode never has real audio files on disk. */
export function voices(): Voices {
  const r = rng(hashStr("voices"));
  const lines: VoiceLine[] = STEP_SEEDS.map((s) => ({
    id: s.id,
    text: s.say,
    hash: hashStr(s.say).toString(16).padStart(8, "0"),
    file: `${s.id}.mp3`,
    exists: false,
    duration_s: round(1.2 + (s.say.length / 16) * 0.25 + r.next() * 0.4, 2),
  }));
  return { base: "/voice/", live: false, model: "speechSynthesis fallback", lines };
}

export { REDFLAG_ITEMS, SYMPTOM_ITEMS, WORDS, PASSAGE };
