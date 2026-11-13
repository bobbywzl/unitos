// Voice typing through the voice model (SPEC.md §6, lib/voice/dictation.ts)
// in a real browser. Chromium takes a looping recording as its microphone: a
// burst of sound, then silence, so the page cuts a phrase at every pause.
// The stand-in for xAI answers each phrase with its number, the odd ones
// late. Checked: the phrases are typed in the order they were said, a press
// on Add note while a phrase is on its way waits for it, and without the
// voice model the browser's own speech service is used and nothing is sent.
//
//   node scripts/qa/mock-services.mjs &
//   XAI_API_KEY=mock XAI_API_URL=http://localhost:3398/v1/stt npm run dev -- --port 3311
//   node scripts/qa/ui-voice-typing.mjs <notebookId> [outDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const [NB, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB) {
  console.error("usage: node scripts/qa/ui-voice-typing.mjs <notebookId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3311";
const MOCK = process.env.MOCK_SERVICES ?? "http://localhost:3398";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** 1.3 s of sound shaped like syllables, then 1.6 s of silence: 16-bit mono. */
function microphoneFile() {
  const rate = 48_000;
  const sound = Math.round(1.3 * rate);
  const total = Math.round(2.9 * rate);
  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < sound; i++) {
    const t = i / rate;
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t);
    const voice = Math.sin(2 * Math.PI * 180 * t) + 0.6 * Math.sin(2 * Math.PI * 720 * t) + 0.4 * Math.sin(2 * Math.PI * 1900 * t);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.3 * syllable * voice)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "unitos-voice-")), "microphone.wav");
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  return file;
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${microphoneFile()}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, permissions: ["microphone"] });
const page = await context.newPage();
const phrases = (text) => [...text.matchAll(/Mock phrase (\d+)\./g)].map((m) => Number(m[1]));
const inOrder = (list) => list.every((n, i) => n === list[0] + i);
const box = () => page.inputValue("[data-phone-box]");

// ── With the voice model ───────────────────────────────────────────────────
await fetch(`${MOCK}/v1/stt/log`, { method: "DELETE" });
await page.goto(`${BASE}/phone?p=${NB}`, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector("[data-phone-box]");
const service = await page.evaluate(() => fetch("/api/speech/transcribe").then((r) => r.json()));
check("the server says the voice model is set", service.model === true && service.any === true, JSON.stringify(service));
await page.fill("[data-phone-box]", "");
await page.waitForTimeout(300);

await page.click('[data-track="phone-voice"]');
await page.waitForFunction(() => /Mock phrase \d+\..*Mock phrase \d+\..*Mock phrase \d+\./s.test(document.querySelector("[data-phone-box]").value), null, { timeout: 60_000 });
const typed = await box();
const first = phrases(typed);
check("the phrases are typed", first.length >= 3, JSON.stringify(typed));
check("the phrases are typed in the order they were said, a late answer too", first[0] === 1 && inOrder(first), JSON.stringify(first));
check("a space joins two phrases, and nothing else is typed", typed.trim() === first.map((n) => `Mock phrase ${n}.`).join(" "), JSON.stringify(typed));
await page.screenshot({ path: `${OUT}/voice-typing.png` });

const sent = (await (await fetch(`${MOCK}/v1/stt/log`)).json()).at(-1)?.fields ?? {};
check("a phrase names the model and the language, asks for no voices", sent.model === "grok-voice-transcribe-2.0" && sent.language === "en" && sent.format === "true" && sent.diarize === undefined, JSON.stringify(sent));

// A press on Add note while a phrase is on its way waits for the phrase.
await page.waitForFunction(() => /Writing/.test(document.querySelector('[role="status"]')?.textContent ?? ""), null, { timeout: 30_000 });
const before = phrases(await box());
// Notes an earlier run left count too: the check is what this press added.
const notes = () => page.locator("[data-phone-note]", { hasText: "Mock phrase 1." }).count();
const notesBefore = await notes();
await page.click('[data-track="phone-add-note"]');
await page.waitForFunction((n) => [...document.querySelectorAll("[data-phone-note]")].filter((el) => el.textContent.includes("Mock phrase 1.")).length > n, notesBefore, { timeout: 30_000 });
await page.waitForTimeout(1500);
const saved = phrases(await page.locator("[data-phone-note]").first().innerText());
check("the note holds the phrase that was on its way when Add note was pressed", saved.length > before.length && inOrder(saved) && saved[0] === 1, `${before.length} typed at the press, ${saved.length} in the note`);
check("Add note ran once", (await notes()) === notesBefore + 1, `${notesBefore} before, ${await notes()} after`);

// The microphone turns off; the words of the last phrase still land.
await page.click('[data-track="phone-voice"]');
await page.waitForFunction(() => !document.querySelector('[role="status"]'), null, { timeout: 30_000 });
const after = phrases(await box());
check("after the microphone is turned off no phrase is lost or doubled", inOrder([...saved, ...after]), JSON.stringify([...saved, ...after]));

// ── Without the voice model ────────────────────────────────────────────────
const page2 = await context.newPage();
await page2.route("**/api/speech/transcribe", (route) =>
  route.request().method() === "GET"
    ? route.fulfill({ status: 200, contentType: "application/json", body: '{"model":false,"any":false}' })
    : route.continue(),
);
let posted = 0;
page2.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/api/speech/transcribe")) posted++;
});
await page2.goto(`${BASE}/phone?p=${NB}`, { waitUntil: "networkidle", timeout: 120_000 });
await page2.waitForSelector("[data-phone-box]");
await page2.click('[data-track="phone-voice"]');
await page2.waitForTimeout(5000);
check("without the voice model no recording is sent: the browser's speech service listens", posted === 0, `${posted} sent`);

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
