// Browser smoke test: open the site, drop a demo through the file picker, wait for the match
// view and take screenshots. Catches anything unit tests can't (worker, wasm, layout).
//
//   python3 -m http.server -d web 8767 &
//   node tools/smoke.mjs <demo.dem> <out.png> [hash suffix, e.g. "?tab=chat&t=900"] [selector to scroll to]
//
// env: BASE (default http://localhost:8767), CHROME (chrome / chrome-headless-shell binary),
//      PLAYWRIGHT (path to playwright-core's index.mjs if it isn't resolvable as a package)
import { pathToFileURL } from "node:url";

const [demo, out, after = "", scrollTo = ""] = process.argv.slice(2);
if (!demo || !out) {
  console.error("usage: node tools/smoke.mjs <demo> <out.png> [hash suffix] [scroll selector]");
  process.exit(2);
}
const pw = process.env.PLAYWRIGHT ? await import(pathToFileURL(process.env.PLAYWRIGHT).href) : await import("playwright-core");
const BASE = process.env.BASE || "http://localhost:8767";

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("response", (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/#/`);
await page.waitForSelector(".drop-field");
const t0 = Date.now();
await page.setInputFiles("input[type=file]", demo);
await page.waitForFunction(() => location.hash.startsWith("#/match/"), null, { timeout: 240000 });
await page.waitForSelector(".tiles .tile", { timeout: 30000 });
console.log(`parsed + opened in ${Date.now() - t0} ms: ${await page.evaluate(() => location.hash)}`);
if (after) {
  await page.evaluate((h) => { location.hash = location.hash.split("?")[0] + h; }, after);
  await page.waitForTimeout(1500);
}
if (scrollTo) {
  await page.evaluate((sel) => { document.querySelector(sel)?.scrollIntoView(); window.scrollBy(0, -100); }, scrollTo);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: out });
await browser.close();
for (const p of problems) console.log(p);
process.exit(problems.length ? 1 : 0);
