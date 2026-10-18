// The fold is the whole of step 2, and every way it can go wrong is invisible on a
// screenshot: a section that quietly reopens on reload, a summary that disappears when
// opened and never comes back, or a browser with storage switched off taking a panel
// down with it. None of those throw.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Fold } from "@/components/fold";

const KEY = "synapshot.folds";

describe("Fold", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts closed and shows its summary instead of its body", () => {
    render(
      <Fold id="t.one" title="Bloods" summary="GFAP 412 pg/mL">
        <p>the whole panel</p>
      </Fold>,
    );
    expect(screen.getByText("GFAP 412 pg/mL")).toBeInTheDocument();
    expect(screen.queryByText("the whole panel")).toBeNull();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("swaps the summary for the body when opened", () => {
    render(
      <Fold id="t.two" title="Bloods" summary="GFAP 412 pg/mL">
        <p>the whole panel</p>
      </Fold>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("the whole panel")).toBeInTheDocument();
    // The summary would otherwise repeat what is now directly below it.
    expect(screen.queryByText("GFAP 412 pg/mL")).toBeNull();
  });

  it("remembers what was opened, and remembers closing it again", () => {
    const one = render(
      <Fold id="t.three" title="Bloods">
        <p>body</p>
      </Fold>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")["t.three"]).toBe(true);

    one.unmount();
    render(
      <Fold id="t.three" title="Bloods">
        <p>body</p>
      </Fold>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")["t.three"]).toBe(false);
  });

  it("does not reopen a section some other id was opened", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "t.other": true }));
    render(
      <Fold id="t.four" title="Bloods">
        <p>body</p>
      </Fold>,
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("stays closed rather than throwing when storage is unreadable", () => {
    // Private mode and some embedded webviews throw here rather than returning null.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    render(
      <Fold id="t.five" title="Bloods" summary="still here">
        <p>body</p>
      </Fold>,
    );
    expect(screen.getByText("still here")).toBeInTheDocument();
    // And it still opens for this session, it just will not be remembered.
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("garbage in storage means closed, not a crash", () => {
    window.localStorage.setItem(KEY, "not json at all");
    render(
      <Fold id="t.six" title="Bloods">
        <p>body</p>
      </Fold>,
    );
    expect(screen.queryByText("body")).toBeNull();
  });

  it("lets a parent drive it, for the sections something other than a click opens", () => {
    const onToggle = vi.fn();
    render(
      <Fold id="t.seven" title="Check-in status" open onToggle={onToggle}>
        <p>body</p>
      </Fold>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalled();
    // Still open: the parent decides, not the stored value.
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
