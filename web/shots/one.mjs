import { chromium } from "playwright";
const [path, out, w = 1440, h = 900, action = ""] = process.argv.slice(2);
const BASE = process.env.SHOT_BASE ?? "http://localhost:8111";
const b = await chromium.launch();
const p = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 }).then(c => c.newPage());
const errs = new Set();
p.on("console", m => m.type() === "error" && errs.add(m.text().slice(0, 150)));
p.on("pageerror", e => errs.add(String(e).slice(0, 150)));
await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(6500);
if (action === "call") {
  await p.getByRole("button", { name: /Call patient/ }).click();
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: /Text the link/ }).click();
  await p.waitForTimeout(4000);
}
if (action === "link") {
  await p.getByRole("button", { name: /Call patient/ }).click();
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: /Just make a link/ }).click();
  await p.waitForTimeout(2500);
}
if (action === "evidence") {
  await p.getByRole("button", { name: /^Evidence$/ }).click();
  await p.waitForTimeout(2000);
}
// Anything matching a tab name opens that tab, so one shot per tab needs no new flag.
if (["Data", "Analysis", "Treatment", "Timeline"].includes(action)) {
  await p.getByRole("tab", { name: action }).click();
  await p.waitForTimeout(action === "Treatment" ? 2500 : 1600);
}
await p.screenshot({ path: out });
console.log(errs.size ? "errors: " + [...errs].join(" | ") : "no console errors");
await b.close();
