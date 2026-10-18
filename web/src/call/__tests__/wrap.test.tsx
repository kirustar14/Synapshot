// The wrap screen finishes the call and then polls until the summary is ready.
//
// This one exists because the first version guarded the whole effect with a ref, which
// React's double mount in development turned into a page that polled zero times.

import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CallStatus } from "@/api/types";
import type { CallCtx } from "@/call/ctx";
import { Ctx } from "@/call/ctx";
import { WrapStage } from "@/call/stages";

const SUMMARY = "Your check-in is complete and your care team has the results.";

function mount(status: () => Promise<CallStatus>, finish: () => Promise<{ ok: boolean; call_id: string }>) {
  const ctx = {
    post: { finish, status },
    voice: { say: () => Promise.resolve(), stop: () => {} },
  } as unknown as CallCtx;
  return render(
    <StrictMode>
      <Ctx.Provider value={ctx}>
        <WrapStage />
      </Ctx.Provider>
    </StrictMode>,
  );
}

describe("the wrap screen", () => {
  it("finishes once and polls until the summary arrives", async () => {
    const finish = vi.fn(() => Promise.resolve({ ok: true, call_id: "chk_1" }));
    let polls = 0;
    const status = vi.fn(() => {
      polls += 1;
      return Promise.resolve(
        polls < 2 ? ({ state: "processing" } as CallStatus) : ({ state: "done", summary: SUMMARY } as CallStatus),
      );
    });

    mount(status, finish);
    expect(await screen.findByText(/being worked through/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(SUMMARY)).toBeInTheDocument(), { timeout: 8000 });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("says the measurements are safe when the summary cannot be built", async () => {
    const status = vi.fn(() => Promise.resolve({ state: "failed" } as CallStatus));
    mount(status, () => Promise.resolve({ ok: true, call_id: "chk_2" }));
    await waitFor(() => expect(screen.getByText(/Your answers were saved/)).toBeInTheDocument(), { timeout: 8000 });
  });
});
