// The face check has to actually start on a phone sized screen.
//
// The failure this is for: the model is 3.8 MB and gitignored, so it does not ship with a
// checkout. `make models` fetches it, but `make dev` did not depend on that and `make
// check` did not verify it, so any machine that skipped the step served a call page where
// the eye measurement silently never ran.

import { expect, test } from "@playwright/test";

test.use({
  permissions: ["camera", "microphone"],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test("the face model loads and the camera check starts", async ({ page, request }) => {
  const pid = (await (await request.get("/api/patients")).json())[0].id;
  const token = (await (await request.post("/api/calls", { data: { patient_id: pid, send: false } })).json()).token;

  // Served from the same origin as the page, so it works behind a tunnel with no CDN.
  const head = await request.head("/models/face_landmarker.task");
  expect(head.status(), "the face model is not being served").toBe(200);
  expect(Number(head.headers()["content-length"] ?? 0)).toBeGreaterThan(1_000_000);

  await page.goto(`/call/${token}`);
  await page.waitForSelector('[role="switch"]');
  for (const sw of await page.getByRole("switch").all()) {
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  }
  await page.getByRole("button", { name: /I agree/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Allow camera/i }).click();
  await page.waitForTimeout(9000);

  // The patient must never be shown the loader's own words.
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("face model");
  expect(body).not.toContain("not on the server");

  // Either the check started, or it failed and said so calmly with a way out.
  if (body.includes("The camera check could not start")) {
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tell my clinic/i })).toBeVisible();
    throw new Error("the face model did not load, which is the bug this test is for");
  }
  await expect(page.getByText(/I can see your face/i)).toBeVisible();
});
