// Care team notes. The note is stored in this workspace timeline and written to the patient
// record through the existing mutation. Drafts are persisted per patient on every keystroke,
// so navigating between tabs never loses an unsaved note.

import { Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useNote } from "@/api/client";
import { SectionCard } from "@/dashboard/components";
import { formatNoteTime, notesFor, readDraft, useNotes, writeDraft } from "@/dashboard/notes";
import { usePatientContext } from "./PatientLayout";

export default function PatientNotes() {
  const { patient } = usePatientContext();
  const notes = notesFor(patient.id);
  const addNote = useNotes((s) => s.add);
  const note = useNote();
  const [draft, setDraft] = useState(() => readDraft(patient.id));

  const change = (text: string) => {
    setDraft(text);
    writeDraft(patient.id, text);
  };

  const save = async () => {
    const text = draft.trim();
    if (text.length < 2) return;
    addNote(patient.id, text);
    change("");
    try {
      await note.mutateAsync({ id: patient.id, text });
      toast.success("Note saved to the workspace and written to the patient record");
    } catch (err) {
      toast.error(
        `Saved in this workspace, but the record write failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <SectionCard
        title="Clinical notes"
        subtitle="Visible to the care team only. Notes are never sent to the patient."
      >
        <label htmlFor="note-draft" className="text-[11px] font-medium text-[#55504a]">
          New note
        </label>
        <textarea
          id="note-draft"
          value={draft}
          onChange={(e) => change(e.target.value)}
          rows={6}
          placeholder="What the next reader should know about this record"
          className="mt-1.5 w-full resize-y rounded-[7px] border border-[#e6e0d6] bg-[#fbf9f4] px-3 py-2.5 text-[12px] leading-relaxed outline-none placeholder:text-[#a49c8f] focus:border-[#c9c0b1] focus:bg-[#fffdfa]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={draft.trim().length < 2 || note.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#b4552f] px-3 text-[12px] font-medium text-[#fff8f3] transition-colors hover:bg-[#a04a27] disabled:bg-[#e7ded2] disabled:text-[#9b9488]"
          >
            <Save className="h-3.5 w-3.5" aria-hidden /> {note.isPending ? "Saving" : "Save note"}
          </button>
          {draft && (
            <button
              type="button"
              onClick={() => change("")}
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e6e0d6] bg-[#fffdfa] px-2.5 text-[11px] text-[#6d675e] hover:bg-[#fbf8f2]"
            >
              <Trash2 className="h-3 w-3" aria-hidden /> Discard draft
            </button>
          )}
          {draft && <span className="text-[10px] text-[#8b8375]">Draft saved for this patient</span>}
        </div>
        <p className="mt-3 rounded-[7px] border border-[#ece6dc] bg-[#fbf9f4] px-3 py-2 text-[10px] leading-relaxed text-[#8b8375]">
          The record endpoint accepts one note at a time, and this prototype does not yet serve a note list back. The
          timeline below is kept in this browser so that nothing is silently lost; each saved note is also written to
          the patient record.
        </p>
      </SectionCard>

      <SectionCard title={`Timeline (${notes.length})`} subtitle="Newest first, stored on this device." bodyClassName="p-0">
        {notes.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] leading-relaxed text-[#6d675e]">
            No notes yet. Anything saved here appears on the overview and in the report preview.
          </p>
        ) : (
          <ul className="divide-y divide-[#f1ece4]">
            {notes.map((n) => (
              <li key={n.id} className="px-4 py-3">
                <p className="text-[10px] text-[#8b8375]">{formatNoteTime(n.createdAt)}</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#55504a]">{n.text}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
