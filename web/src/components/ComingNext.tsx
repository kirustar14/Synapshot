// Scaffold marker. Every route renders one of these until the screen behind it is built.
// Delete the ComingNext block when you fill a page in, and keep the PageHeader.

import { Hammer } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "./common";

export function ComingNext({ code, items }: { code: string; items: ReactNode[] }) {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Hammer className="h-4 w-4 text-primary" aria-hidden /> {code}, coming next
        </span>
      }
      subtitle="The shell, the theme, the API client and the seeded mock layer are in place. This screen is next."
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
