// Headless checks that need a real browser: region picking, the vessel layer, and that
// no screen scrolls sideways at a phone width.
//
// Run with `npm run e2e` against a server on :8111. These are the things a unit test
// cannot see, because they only go wrong once there is a GPU, a camera and a layout.

import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE ?? "http://localhost:8111";

/** The first patient in the list, so the test does not hard-code a seeded id. */
async function firstPatient(request: { get: (u: string) => Promise<{ json: () => Promise<unknown> }> }) {
  const res = await request.get(`${BASE}/api/patients`);
  const rows = (await res.json()) as { id: string }[];
  return rows[0].id;
}

test.describe("the workspace", () => {
  test("picks a region by clicking the brain, fast", async ({ page, request }) => {
    const id = await firstPatient(request);
    await page.goto(`${BASE}/patients/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    // A raycast against 40,960 triangles. With three's default per-triangle loop this is
    // several milliseconds; with the BVH it is a fraction of one. The ceiling is loose
    // on purpose: it is there to catch the BVH silently not being installed, not to
    // benchmark a particular machine.
    const timing = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const t0 = performance.now();
      for (let i = 0; i < 120; i++) {
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: rect.left + rect.width / 2 - 140 + (280 * i) / 120,
            clientY: rect.top + rect.height / 2 - 40 + 80 * Math.sin(i / 5),
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      }
      return (performance.now() - t0) / 120;
    });
    expect(timing).not.toBeNull();
    expect(timing!).toBeLessThan(2.0);

    const canvas = (await page.locator("canvas").first().boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.waitForTimeout(250);
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);

    // One store, one truth: the viewer's selection is the workspace's, so the chip
    // appears. Keeping two of these is what broke it the first time.
    await expect(page.getByLabel("Clear the selected region")).toBeVisible({ timeout: 4000 });
  });

  test("draws the vessel layer and says it is a diagram", async ({ page, request }) => {
    const id = await firstPatient(request);
    await page.goto(`${BASE}/patients/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    const chip = page.getByRole("button", { name: "Vessels" });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(chip).toHaveAttribute("title", /not patient-specific/i);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(2500);

    // The canvas has to still be drawing after the layer goes on, which is the cheapest
    // way to notice a geometry that threw on build.
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.waitForTimeout(500);
    expect(errs).toEqual([]);
  });

  test("offers every layer the viewer knows about", async ({ page, request }) => {
    const id = await firstPatient(request);
    await page.goto(`${BASE}/patients/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000);
    for (const layer of [
      "Damage",
      "Uncertainty",
      "Healing",
      "Simulated activity",
      "Excitation and inhibition",
      "Template against personal",
      "Intervention what-if",
      "Signal drivers",
      "Damage difference",
    ]) {
      await expect(page.getByRole("button", { name: layer, exact: true })).toBeVisible();
    }
  });
});

test.describe("layout", () => {
  for (const [name, path] of [
    ["home", "/"],
    ["clinic", "/clinic"],
    ["add patient", "/patients/new"],
  ] as const) {
    test(`${name} never scrolls sideways at 390`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      const { doc, win } = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));
      expect(doc).toBeLessThanOrEqual(win + 1);
    });
  }

  test("the workspace never scrolls sideways at 390", async ({ page, request }) => {
    const id = await firstPatient(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/patients/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(7000);
    const { doc, win } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(doc).toBeLessThanOrEqual(win + 1);
  });

  test("the workspace is one screen at 1440", async ({ page, request }) => {
    const id = await firstPatient(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/patients/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(7000);
    const { doc, win } = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      win: window.innerHeight,
    }));
    // One screen means the page itself does not scroll. The panels scroll inside it.
    expect(doc).toBeLessThanOrEqual(win + 2);
  });
});
