// Screenshot every screen at both widths, for looking at before and after a change.
//
// Usage: node shots/shoot.mjs <label>   writes shots/<label>/<screen>-<width>.png
//
// Each screen waits for its own slowest thing rather than a blanket sleep: the brain
// needs the mesh fetched and a few frames drawn, the rest only needs the fetches.

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:8111";
const label = process.argv[2] ?? "now";
const only = process.argv[3] ?? "";
const dir = new URL(`./${label}/`, import.meta.url).pathname;
await mkdir(dir, { recursive: true });

const browser = await chromium.launch();
const errs = new Set();

async function patientId() {
  const page = await browser.newPage();
  const res = await page.request.get(`${BASE}/api/patients`);
  const rows = await res.json();
  await page.close();
  // The flagship if it is there, else the first row.
  const maya = rows.find((r) => String(r.name).includes("Maya"));
  return (maya ?? rows[0]).id;
}

const pid = await patientId();

/** One screenshot. `after` runs once the page is up, for clicks and waits. */
async function shot(name, path, width, height, after) {
  if (only && !name.startsWith(only)) return;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errs.add(`${name}: ${m.text().slice(0, 120)}`));
  page.on("pageerror", (e) => errs.add(`${name}: ${String(e).slice(0, 120)}`));
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    if (after) await after(page);
    await page.screenshot({ path: `${dir}${name}-${width}.png` });
    console.log(`  ${name}-${width}`);
  } catch (err) {
    console.log(`  ${name}-${width}  FAILED ${String(err).slice(0, 90)}`);
  } finally {
    await ctx.close();
  }
}

const brain = async (page) => {
  await page.waitForSelector("canvas", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(6500);
};

const tab = (which) => async (page) => {
  await brain(page);
  await page.getByRole("tab", { name: which }).click().catch(() => {});
  await page.waitForTimeout(which === "Treatment" ? 2500 : 1600);
};

for (const [w, h] of [[1440, 900], [390, 844]]) {
  await shot("home", "/", w, h, brain);
  await shot("clinic", "/clinic", w, h);
  await shot("add-patient", "/patients/new", w, h);
  await shot("workspace-data", `/patients/${pid}`, w, h, tab("Data"));
  await shot("workspace-analysis", `/patients/${pid}`, w, h, tab("Analysis"));
  await shot("workspace-treatment", `/patients/${pid}`, w, h, tab("Treatment"));
  await shot("workspace-timeline", `/patients/${pid}`, w, h, tab("Timeline"));
  await shot("call-modal", `/patients/${pid}`, w, h, async (page) => {
    await brain(page);
    await page.getByRole("button", { name: /Call patient/ }).click().catch(() => {});
    await page.waitForTimeout(1200);
    // Make a link so the modal shows its full state, not just the two start buttons.
    await page.getByRole("button", { name: /Just make a link|Make a link/ }).click().catch(() => {});
    await page.waitForTimeout(2500);
  });
  await shot("evidence", `/patients/${pid}`, w, h, async (page) => {
    await brain(page);
    await page.getByRole("button", { name: /^Evidence$/ }).click().catch(() => {});
    await page.waitForTimeout(2000);
  });
}

if (errs.size) {
  console.log("\n  console errors:");
  for (const e of errs) console.log(`    ${e}`);
}
console.log(`\n  -> web/shots/${label}/`);
await browser.close();
