/* Test van beide apps (trainersapp en gymles-app), zonder webserver en zonder Supabase.
   Gebruik: zet floorball-training en floorball-gymles naast elkaar in één map en start
     node floorball-training/tools/test-apps.js
   Controleert per pagina op telefoonbreedte (400 px) en desktop (1280 px):
   - geen javascriptfouten en niet breder dan het scherm;
   - de belangrijkste vensters gaan open (Uitleg, Mijn training/gymles, Materiaal, Bibliotheek);
   - in de gymles-app nergens het woord "training" en de eigen naam, iconen en manifest.
   Alle verzoeken naar Supabase en andere sites worden geblokkeerd, dus testklikken tellen niet mee als scores.
   Stopt met exitcode 1 als er iets mis is. */
const fs = require("fs"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { console.error("Playwright ontbreekt (npm i -g playwright)."); process.exit(2); }

const ROOT = path.resolve(__dirname, "..", "..");              // map met beide repositories
const HOST = "https://ufcutrecht.github.io";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
if (!fs.existsSync(path.join(ROOT, "floorball-gymles"))) { console.error(`floorball-gymles niet gevonden naast floorball-training (${ROOT}).`); process.exit(2); }

const PAGES = [
  { app: "training", url: "/floorball-training/" , home: true },
  { app: "training", url: "/floorball-training/gymles/" },
  { app: "training", url: "/floorball-training/o12/" },
  { app: "training", url: "/floorball-training/o14/" },
  { app: "training", url: "/floorball-training/o18/" },
  { app: "gymles", url: "/floorball-gymles/", home: true },
  { app: "gymles", url: "/floorball-gymles/gymles/" },
  { app: "gymles", url: "/floorball-gymles/o12/" },
];
const SIZES = [{ name: "telefoon", width: 400, height: 860 }, { name: "desktop", width: 1280, height: 900 }];
/* "training" mag in de gymles-app alleen voorkomen in deze uitzonderingen (bijvoorbeeld een verwijzing naar de club) */
const ALLOW_TRAINING = [];                                     // bijvoorbeeld [/trainen bij UFC Utrecht/i]

const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

async function serve(ctx) {
  await ctx.route("**/*", r => {
    const u = new URL(r.request().url());
    if (u.origin !== HOST) return r.abort();                     // Supabase, lettertypes en andere sites: geblokkeerd
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) return r.fulfill({ status: 403, body: "" });
    if (f.endsWith(path.sep) || f.endsWith("/")) f = path.join(f, "index.html");
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: "" });
    r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
}

function checkGymText(where, text) {
  for (const line of text.split("\n")) {
    if (!/training/i.test(line) || ALLOW_TRAINING.some(re => re.test(line))) continue;
    fail(where, `woord "training" in de gymles-app: "${line.trim().slice(0, 100)}"`);
  }
}

async function visible(page) {                                   // zichtbare tekst van de pagina en een open venster
  return page.evaluate(() => { const d = [...document.querySelectorAll("dialog[open]")].pop(); return (d || document.body).innerText; });
}

async function testPage(browser, p, size) {
  const where = `${p.url} (${size.name})`;
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: "reduce" });
  await serve(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", e => fail(where, "javascriptfout: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) fail(where, "consolefout: " + m.text().slice(0, 160)); });
  page.on("dialog", d => d.dismiss());
  const gym = p.app === "gymles";
  const texts = [];
  try {
    await page.goto(HOST + p.url, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > size.width + 1) fail(where, `pagina is ${sw} px breed (scherm ${size.width} px)`);
    texts.push(await visible(page));
    if (!p.home) {
      if (!(await page.locator("#grid [data-toggle]").count())) fail(where, "geen oefeningen gevonden");
      if (gym) {
        const head = await page.evaluate(() => ({
          manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") || "",
          icon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") || "",
          name: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || "",
          title: document.title,
        }));
        if (!head.manifest.includes("floorball-gymles/")) fail(where, "manifest is niet dat van de gymles-app: " + head.manifest);
        if (!head.icon.includes("gymles-")) fail(where, "icoon voor het beginscherm is niet het gymles-icoon: " + head.icon);
        if (head.name !== "Floorball gymles") fail(where, "naam op het beginscherm is " + JSON.stringify(head.name));
        texts.push(head.title);
      }
      // twee oefeningen kiezen, alle vensters openen
      for (const i of [0, 1]) await page.locator("#grid [data-toggle]").nth(i).click();
      const steps = [
        ["#open-mat", async () => { await page.click("#do-save"); await page.waitForTimeout(150); texts.push(await page.inputValue("#save-name"), await page.textContent("#save-hint")); }],
        ["#open-ob, #open-set", null],
        ["#open-gen, #open-bib", async () => { const ok = page.locator("#gen [data-load]"); if (await ok.count()) { await ok.click(); await page.waitForTimeout(250); if (!(await page.locator("#mat[open] #ob-body .ob-step").count())) fail(where, "Akkoord opent geen training met ombouw"); } }],
        ["#open-bib", null],
        ["#grid [data-open]", null],
      ];
      for (const [sel, extra] of steps) {
        await page.locator(sel).first().click();
        await page.waitForTimeout(250);
        if (!(await page.locator("dialog[open]").count())) { fail(where, `venster opent niet (${sel})`); continue; }
        texts.push(await visible(page));
        if (extra) await extra();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
      }
    }
  } catch (e) { fail(where, "test brak af: " + e.message.split("\n")[0]); }
  if (gym) checkGymText(where, texts.join("\n"));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) for (const p of PAGES) { process.stdout.write(`. ${p.url} (${size.name})\n`); await testPage(browser, p, size); }
  await browser.close();
  const uniq = [...new Set(problems)];
  if (uniq.length) { console.log(`\n${uniq.length} probleem/problemen:\n- ` + uniq.join("\n- ")); process.exit(1); }
  console.log("\nAlles in orde.");
})();
