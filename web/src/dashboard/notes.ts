// The note endpoint writes a note onto the patient record but the contract has no read route
// for clinician notes. So the workspace keeps its own note timeline in this browser, and each
// saved note is also written to the record through the existing mutation. Drafts are kept per
// patient, so switching tabs or patients never silently loses typing.

import { create } from "zustand";

export interface LocalNote {
  id: string;
  text: string;
  createdAt: string;
}

const NOTE_KEY = "synapshot-note-timeline";
const DRAFT_PREFIX = "synapshot-note-draft:";

type Timeline = Record<string, LocalNote[]>;

function readTimeline(): Timeline {
  try {
    const raw = localStorage.getItem(NOTE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Timeline;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTimeline(timeline: Timeline) {
  try {
    localStorage.setItem(NOTE_KEY, JSON.stringify(timeline));
  } catch {
    // Storage can be blocked. Notes still work for this page visit.
  }
}

interface NotesState {
  timeline: Timeline;
  add: (patientId: string, text: string) => LocalNote;
}

export const useNotes = create<NotesState>((set, get) => ({
  timeline: typeof window === "undefined" ? {} : readTimeline(),
  add: (patientId, text) => {
    const note: LocalNote = {
      id: `n_${Date.now().toString(36)}`,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    const timeline = {
      ...get().timeline,
      [patientId]: [note, ...(get().timeline[patientId] ?? [])],
    };
    writeTimeline(timeline);
    set({ timeline });
    return note;
  },
}));

/** Stable empty array: a fresh [] on every selector call would re-render without end. */
const NO_NOTES: LocalNote[] = [];

export const notesFor = (patientId: string) => useNotes((s) => s.timeline[patientId] ?? NO_NOTES);

export function readDraft(patientId: string): string {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${patientId}`) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(patientId: string, text: string) {
  try {
    if (text) localStorage.setItem(`${DRAFT_PREFIX}${patientId}`, text);
    else localStorage.removeItem(`${DRAFT_PREFIX}${patientId}`);
  } catch {
    // No persistence available; the textarea still holds the draft for this visit.
  }
}

export const formatNoteTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
