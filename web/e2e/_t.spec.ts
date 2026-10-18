import { test } from "@playwright/test";
test.use({ viewport:{width:1500,height:1000}, deviceScaleFactor:2, launchOptions:{args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]}});
test("treatment", async ({ page, request }) => {
  const pid = (await (await request.get("/api/patients")).json())[0].id;
  await page.goto(`/patients/${pid}`);
  await page.waitForTimeout(8000);
  await page.getByRole("tab", { name: /Treatment/i }).click();
  await page.waitForTimeout(2500);
  await page.locator("aside").screenshot({ path: process.env.SHOT! });
});
