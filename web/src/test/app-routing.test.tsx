import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/scene/Environment", () => ({ default: () => null }));

/** Renders the real router at a path with a throwaway query client. */
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("app routing", () => {
  it("renders the clinic list against the mock layer", async () => {
    renderAt("/clinic");
    // "Clinic" is the mono eyebrow above the headline now; the heading is the sentence.
    expect(await screen.findByRole("heading", { name: /Everyone you are following/i })).toBeInTheDocument();
    expect(screen.getAllByText("Clinic").length).toBeGreaterThan(0);
    expect(await screen.findByText(/patients,.*open flag/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add patient/ })).toBeInTheDocument();
    // The per-row Synthetic badge and the Data column it sat in are gone. A label on
    // every row of every screen is one nobody reads by the second screen.
    expect(screen.queryByText("Synthetic")).toBeNull();
    expect(screen.queryByText("Research prototype")).toBeNull();
  });

  it("renders the add patient page with its build log", async () => {
    renderAt("/patients/new");
    expect(await screen.findByRole("heading", { name: "Add a patient" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use sample patient files/ })).toBeInTheDocument();
    // The five steps are listed before anything runs, so the screen says what it will do.
    for (const step of [
      "Reading the files",
      "Pulling out the facts",
      "Checking them against the schema",
      "Building the twin",
      "Fitting the first forecast",
    ]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("renders the workspace as one screen with four tabs", async () => {
    renderAt("/patients/p3");
    expect(await screen.findByRole("heading", { name: "Priya Nandakumar" })).toBeInTheDocument();
    for (const tab of ["Data", "Analysis", "Treatment", "Timeline"]) {
      expect(await screen.findByRole("tab", { name: tab })).toBeInTheDocument();
    }
    // The mechanism is on the screen, which is the point of the top bar.
    expect((await screen.findAllByText(/Ski collision/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Call patient/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Evidence/ })).toBeInTheDocument();
  });

  it("opens the public landing with its login link", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Ongoing insight for recovering minds.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.queryByRole("textbox", { name: "Email" }),
    ).not.toBeInTheDocument();
  });

  it("opens the clinician overview with the persistent rail", async () => {
    renderAt("/app");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Overview" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByText("Patients")).toBeInTheDocument();
    expect(within(nav).getByText("Assessments")).toBeInTheDocument();
    expect(within(nav).queryByText("Clinician")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Account menu/ }),
    ).toBeInTheDocument();
  });

  it("renders the patient worklist with display names, not identifiers", async () => {
    renderAt("/app/patients");

    const list = await screen.findByRole("region", { name: "Patients" }, { timeout: 5000 });
    expect(await within(list).findByText("Priya Nandakumar")).toBeInTheDocument();
    expect(within(list).getAllByRole("row")).toHaveLength(7); // header plus six records
    expect(within(list).queryByText(/^PT-\d+/)).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Review status/ })).toBeInTheDocument();
  });

  it("renders a patient record with contextual tabs from the mock layer", async () => {
    renderAt("/app/patients/p3");

    expect(
      await screen.findByRole("heading", { name: "Priya Nandakumar" }),
    ).toBeInTheDocument();
    const tabs = await screen.findByRole("navigation", { name: "Patient sections" });
    for (const label of ["Overview", "Assessments", "Recovery model", "Notes", "Reports"]) {
      expect(within(tabs).getByText(label)).toBeInTheDocument();
    }
    expect(
      (await screen.findAllByText(/Ski collision/)).length,
    ).toBeGreaterThan(0);
  });

  it("deep links to an assessment for a patient", async () => {
    renderAt("/app/patients/p3/assessments/p3-c6");

    expect(
      await screen.findByRole("heading", { name: "Priya Nandakumar" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("tab", { name: "Cognitive tasks" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("heading", { name: /Assessment timeline/ }),
    ).toBeInTheDocument();
  });

  it("renders the patient call page outside the clinic shell", async () => {
    renderAt("/call/abc123");

    expect(await screen.findByText(/Weekly check-in/)).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Main" }),
    ).not.toBeInTheDocument();
  });
});
