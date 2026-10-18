import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  it("has exactly the five routes the app is supposed to have", () => {
    // A sixth route is the thing this version exists to not have. The clinic routes sit
    // inside a shell, so they are counted through its children.
    const paths: string[] = [];
    for (const route of routes) {
      if (route.path) paths.push(route.path);
      for (const child of route.children ?? []) if (child.path) paths.push(child.path);
    }
    expect(paths.sort()).toEqual(
      ["*", "/", "/call/:token", "/clinic", "/patients/:id", "/patients/new"].sort(),
    );
  });

  it("opens on the landing page, not on a list", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: /Synapshot/ })).toBeInTheDocument();
    expect(screen.getByText("A snapshot of your brain, every week.")).toBeInTheDocument();
    expect(
      screen.getByText(/Research prototype. Not a medical device. Synthetic data./),
    ).toBeInTheDocument();
  });

  it("renders the clinic list against the mock layer", async () => {
    renderAt("/clinic");
    expect(await screen.findByRole("heading", { name: "Clinic" })).toBeInTheDocument();
    expect(await screen.findByText(/patients,.*open flag/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add patient/ })).toBeInTheDocument();
    // Every row says the data is synthetic, on the row rather than once in a footnote.
    expect((await screen.findAllByText("Synthetic")).length).toBeGreaterThan(0);
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

  it("renders the patient call page outside the clinic shell", async () => {
    renderAt("/call/abc123");
    expect(await screen.findByText(/Weekly check-in/)).toBeInTheDocument();
    // No clinician chrome anywhere near the page a patient opens from a text.
    expect(screen.queryByRole("button", { name: /Call patient/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Demo mode")).not.toBeInTheDocument();
  });
});
