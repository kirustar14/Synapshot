// One collapsible section, used everywhere a panel has more than a screenful.
//
// Every one of these starts closed. The workspace used to open six sections at once and
// the right-hand column was a wall of labelled numbers before anybody had asked a
// question; what you could see was mostly not what you were looking for. Closed by
// default means the column is a list of questions, and opening one is an answer.
//
// A closed section still has to earn its line, so each one carries a summary: the two or
// three values somebody would have opened it for. If the summary is all you needed, you
// never open it.
//
// Which ones are open is remembered per browser, so a clinician who always wants Bloods
// open gets Bloods open. The storage is wrapped because localStorage throws rather than
// returns null in private mode and inside some embedded webviews, and a thrown storage
// error must never be the reason a panel does not render. Anything unreadable means
// closed, which is the safe default in both directions: nothing hidden that was open, and
// no wall of text on a fresh machine.

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

const KEY = "synapshot.folds";

/** What is open, or an empty map if the browser will not say. */
function read(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const got: unknown = raw ? JSON.parse(raw) : {};
    return got && typeof got === "object" ? (got as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function write(all: Record<string, boolean>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode, a full quota, or a webview with storage off. The fold still works
    // for this session; it just will not be remembered.
  }
}

/** Open state for one section, remembered by id. Closed unless it was explicitly opened. */
export function useFold(id: string) {
  const [open, setOpen] = useState(() => read()[id] === true);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    write({ ...read(), [id]: next });
  };
  return [open, toggle] as const;
}

/**
 * A section with a summary line.
 *
 * Pass `open` and `onToggle` to drive it from outside, for the cases where something
 * other than a click should open it. Leave them off and it remembers itself.
 */
export function Fold({
  id,
  title,
  summary,
  children,
  open: forced,
  onToggle,
  boxed = false,
  className,
}: {
  id: string;
  title: string;
  /** The one line shown while it is closed. Keep it to what somebody opens this for. */
  summary?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  /** A card with its own outline, for a fold sitting loose rather than in a stack. */
  boxed?: boolean;
  className?: string;
}) {
  const own = useFold(id);
  const open = forced ?? own[0];
  const toggle = onToggle ?? own[1];

  return (
    <section
      className={cn(
        boxed ? "rounded-lg border border-border/70" : "border-b border-border/60 last:border-b-0",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring",
          boxed ? "px-3 py-2 outline-none" : "py-2.5",
        )}
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        <span className="shrink-0 text-xs font-black uppercase tracking-wide">{title}</span>
        {!open && summary !== undefined && (
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className={boxed ? "border-t border-border/60 px-3 py-2.5" : "pb-3"}>{children}</div>
      )}
    </section>
  );
}
