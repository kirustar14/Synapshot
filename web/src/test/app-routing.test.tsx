import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "@/App";

/** Renders the real router at a path with a throwaway query client. */
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("app routing", () => {
  it("renders the patient list against the mock layer", async () => {
    renderAt("/");

    // The headline says who needs attention, so its exact words depend on the cohort.
    expect(await screen.findByRole("heading", { level: 1, name: /need a look|needs a look|on track/ })).toBeInTheDocument();
    const list = await screen.findByRole("region", { name: "Patients" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("renders a patient record from the mock layer", async () => {
    renderAt("/patients/p3");

    expect(await screen.findByRole("heading", { name: "Priya Nandakumar" })).toBeInTheDocument();
    expect(await screen.findByRole("navigation", { name: "Patient sections" })).toBeInTheDocument();
    expect((await screen.findAllByText(/Ski collision/)).length).toBeGreaterThan(0);
  });

  it("renders the patient call page outside the clinic shell", async () => {
    renderAt("/call/abc123");

    expect(await screen.findByText(/Weekly check-in/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});
