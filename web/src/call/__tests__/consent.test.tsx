// The consent gate, rendered for real against the mock layer.
//
// Nothing in the call may run until the three required boxes are ticked, so this checks the
// button really is dead until they are, and that the genetic box starts off.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CallScript } from "@/api/types";
import { CallRunner } from "@/call/CallRunner";

function script(): CallScript {
  return {
    consent: ["This is a research check-in.", "The assistant is software, not a person."],
    steps: [
      { id: "redflags", say: "Seven safety questions.", task: "redflags", minutes: 1, tier: "safety", params: {} },
      { id: "wrap", say: "That is everything.", task: "wrap", minutes: 0.5, tier: "none", params: {} },
    ],
    voice_base: "/voice/",
    symptom_items: ["headache"],
    redflag_items: ["Is your headache getting worse?"],
    words: ["apple"],
    passage: "a passage",
    picture: "kitchen",
    fluency_seconds: 60,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CallRunner token="test-token" script={script()} />
    </QueryClientProvider>,
  );
}

describe("the consent stage", () => {
  it("shows the paragraphs, the progress bar, pause and stop", () => {
    mount();
    expect(screen.getByText("This is a research check-in.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("keeps the start button dead until all three required boxes are on", () => {
    mount();
    expect(screen.getByRole("button", { name: /I agree, start the check-in/i })).toBeDisabled();

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(4);
    expect(switches[3]).toHaveAttribute("aria-checked", "false");

    fireEvent.click(switches[0]);
    fireEvent.click(switches[1]);
    expect(screen.getByRole("button", { name: /I agree, start the check-in/i })).toBeDisabled();
    fireEvent.click(switches[2]);
    expect(screen.getByRole("button", { name: /I agree, start the check-in/i })).toBeEnabled();
    expect(screen.getAllByRole("switch")[3]).toHaveAttribute("aria-checked", "false");
  });

  it("offers the stop and contact my clinic confirmation", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("dialog", { name: /stop the check-in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes, stop and tell my clinic/i })).toBeInTheDocument();
  });
});
