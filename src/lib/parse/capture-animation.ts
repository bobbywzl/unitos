import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Locator, Page } from "playwright-core";
import { encodeGif, type GifFrame } from "@/lib/parse/gif";

// A chart the page's scripts animate (lib/parse/render-page.ts). The static
// DOM holds one instant of it — for a chart that draws over a loop, whatever
// instant the render caught, often nothing yet. Here the page's clock is
// paused and stepped (Playwright's clock: Date, timers, and
// requestAnimationFrame), so the chart's animation runs at a known pace,
// and its shape after each step says what kind of motion it is:
//
// - still: the chart never changes — it stays as it is.
// - one-shot: the chart moves, then holds for SETTLE_MS — it stays as it
//   settled (an entrance animation, drawn to its end).
// - loop: the chart repeats after a period — one period of it is
//   screenshotted frame by frame, encoded as a looping GIF (lib/parse/gif.ts),
//   stored, and the <img> of it takes the svg's place in the page, with the
//   svg's label as its alt and its rendered size as its width and height.
//
// The shape is the numbers in the svg's markup (coordinates, opacities,
// sizes), read after each step. A still or settled chart repeats its shape
// exactly. A loop repeats it within a tolerance: the page's animation clock
// and the stepped clock drift by less than one frame per loop, so each
// number may differ by a fraction of what it moves in one step.

// One step of the page's clock, and one GIF frame.
const STEP_MS = 100;
// Steps sampled at most: a chart that neither holds nor repeats in this time
// stays as it is.
const MAX_SAMPLES = 300;
// Steps the clock runs between two reads of the samples: the page samples
// itself every step (startSampler), so a batch costs two round trips to the
// browser — one to step, one to read — where a step at a time cost two each.
// Over a remote browser (Browserless) a round trip is tens of milliseconds
// and a session is minutes at most. The first batch is the still check.
const STILL_MS = 1_000;
const SAMPLE_BATCH = 30;
// A chart that holds for this long has settled.
const SETTLE_MS = 4_000;
// A loop is at least this long, and at least this much of a second period
// must repeat the first before it counts.
const MIN_PERIOD_MS = 1_000;
const VERIFY_MS = 3_000;
// Numbers this far apart are the same number; over a loop, plus this share
// of the most a number moves in one step.
const EPSILON = 0.05;
const DRIFT_SHARE = 0.3;
// Charts captured per page, at most; a GIF larger than this drops to half
// the frames, and past that the svg stays.
const MAX_CHARTS = 4;
const MAX_GIF_BYTES = 6_000_000;
// A chart's rendered size, at least, to be a chart.
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
// The recording measures its frames as it goes, and when the loop will not
// be done by the deadline at a frame per step — with this share of the time
// left to spare — records every second, third, or fourth step at the
// matching delay: a coarser GIF in time over a slow link (a remote browser)
// rather than none.
const PROBE_FRAMES = 5;
const MAX_STRIDE = 4;
const TIME_SPARE = 0.3;

const MARK = "data-unitos-chart";

/** Stores one GIF and answers the src the page's <img> gets; null when it
    cannot be stored. */
export type CaptureStore = (gif: Uint8Array) => Promise<string | null>;

export type CaptureResult = {
  // Charts the page draws, by what their motion turned out to be.
  still: number;
  settled: number;
  looped: number;
  // Neither held nor repeated in the time sampled, or failed: left as they were.
  undecided: number;
};

type Shape = number[];

/** Two shapes within a tolerance per number: EPSILON alone, or EPSILON plus
    the drift allowance. */
function sameShape(a: Shape, b: Shape, drift: Float64Array | null = null): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const tolerance = EPSILON + (drift ? drift[i] : 0);
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

/** Per number, the most it moves in one step, times DRIFT_SHARE. */
function driftAllowance(samples: Shape[]): Float64Array {
  const drift = new Float64Array(samples[0].length);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.length !== b.length) continue;
    for (let k = 0; k < drift.length; k++) {
      const delta = Math.abs(b[k] - a[k]) * DRIFT_SHARE;
      if (delta > drift[k]) drift[k] = delta;
    }
  }
  return drift;
}

/** The smallest period, in samples, after which the samples repeat; null
    when none does within what was sampled. */
function periodOf(samples: Shape[]): number | null {
  const minPeriod = Math.ceil(MIN_PERIOD_MS / STEP_MS);
  const verify = Math.ceil(VERIFY_MS / STEP_MS);
  const drift = driftAllowance(samples);
  for (let period = minPeriod; period + verify <= samples.length; period++) {
    let repeats = true;
    for (let i = 0; i + period < samples.length; i++) {
      if (!sameShape(samples[i], samples[i + period], drift)) {
        repeats = false;
        break;
      }
    }
    if (repeats) return period;
  }
  return null;
}

// The chart's shape: the count of its elements, then every number in its
// markup. The page samples it under its stepped clock (startSampler): a
// timer on the page's clock appends the shape to a list on the window every
// STEP_MS of the page's time, after the frames the page drew in that step.
const SAMPLES = "__unitosChartSamples";

async function startSampler(chart: Locator): Promise<void> {
  await chart.evaluate(
    // No inner named function: a bundler that keeps function names would
    // reference a helper the page does not have once this is serialized.
    (el, { key, stepMs }) => {
      const store = window as unknown as Record<string, unknown>;
      const samples: number[][] = [
        [el.querySelectorAll("*").length, ...(el.outerHTML.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number)],
      ];
      store[key] = samples;
      store[`${key}Timer`] = setInterval(
        () =>
          samples.push([
            el.querySelectorAll("*").length,
            ...(el.outerHTML.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number),
          ]),
        stepMs,
      );
    },
    { key: SAMPLES, stepMs: STEP_MS },
  );
}

/** The samples the page took from the given index on. */
function readSamples(page: Page, from: number): Promise<Shape[]> {
  return page.evaluate(
    ({ key, from }) => ((window as unknown as Record<string, number[][]>)[key] ?? []).slice(from),
    { key: SAMPLES, from },
  );
}

async function stopSampler(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const store = window as unknown as Record<string, unknown>;
    clearInterval(store[`${key}Timer`] as ReturnType<typeof setInterval>);
    delete store[`${key}Timer`];
    delete store[key];
  }, SAMPLES);
}

/** Mark the page's charts — every inline svg with a viewBox outside the
    page's chrome, drawn at a chart's size — and count them. */
function markCharts(page: Page): Promise<number> {
  return page.evaluate(
    ({ mark, minWidth, minHeight }) => {
      let n = 0;
      for (const svg of document.querySelectorAll("svg[viewBox]")) {
        if (svg.closest("nav, header, footer") || svg.parentElement?.closest("svg")) continue;
        const rect = svg.getBoundingClientRect();
        if (rect.width < minWidth || rect.height < minHeight) continue;
        svg.setAttribute(mark, String(n++));
      }
      return n;
    },
    { mark: MARK, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT },
  );
}

async function unmarkCharts(page: Page): Promise<void> {
  await page.evaluate((mark) => {
    for (const el of document.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);
  }, MARK);
}

/** The frame's pixels, from a PNG screenshot. */
async function pixelsOf(png: Buffer): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, rgba: data };
}

/** One period of the chart, frame by frame from where its clock stands.
    Null when the chart has no box on screen, changes size mid-loop, or the
    deadline passes before the loop is whole. */
async function recordLoop(
  page: Page,
  chart: Locator,
  period: number,
  deadline: number,
): Promise<{ width: number; height: number; frames: GifFrame[] } | null> {
  const box = await chart.boundingBox();
  if (!box || box.width < MIN_WIDTH || box.height < MIN_HEIGHT) return null;
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  const frames: GifFrame[] = [];
  let width = 0;
  let height = 0;
  let stride = 1;
  const startedAt = Date.now();
  for (let step = 0; step < period; step += stride) {
    if (Date.now() > deadline) return null;
    if (frames.length >= PROBE_FRAMES && frames.length % PROBE_FRAMES === 0) {
      const perFrame = (Date.now() - startedAt) / frames.length;
      const left = Math.max(1, deadline - Date.now()) * (1 - TIME_SPARE);
      const need = Math.ceil((perFrame * (period - step)) / left);
      stride = Math.min(MAX_STRIDE, Math.max(stride, need));
    }
    const png = await page.screenshot({ type: "png", clip });
    const pixels = await pixelsOf(png);
    if (frames.length === 0) {
      width = pixels.width;
      height = pixels.height;
    } else if (pixels.width !== width || pixels.height !== height) {
      return null;
    }
    // The last frame holds until the loop's end, whatever the stride.
    const steps = Math.min(stride, period - step);
    frames.push({ rgba: pixels.rgba, delayMs: STEP_MS * steps });
    await page.clock.runFor(STEP_MS * steps);
  }
  return { width, height, frames };
}

/** The GIF, within the byte cap: every frame, else every other frame at
    twice the delay, else null. */
function encodeWithinCap(width: number, height: number, frames: GifFrame[]): Uint8Array | null {
  const full = encodeGif(width, height, frames);
  if (full.length <= MAX_GIF_BYTES) return full;
  const half = frames.filter((_, i) => i % 2 === 0).map((frame) => ({ ...frame, delayMs: frame.delayMs * 2 }));
  const smaller = encodeGif(width, height, half);
  return smaller.length <= MAX_GIF_BYTES ? smaller : null;
}

/** Put the GIF in the svg's place. */
async function replaceWithImage(chart: Locator, src: string, width: number, height: number): Promise<void> {
  await chart.evaluate(
    (svg, { src, width, height }) => {
      const img = document.createElement("img");
      img.setAttribute("src", src);
      img.setAttribute("alt", svg.getAttribute("aria-label") ?? svg.querySelector("title")?.textContent ?? "");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      const className = svg.getAttribute("class");
      if (className) img.setAttribute("class", className);
      svg.replaceWith(img);
    },
    { src, width, height },
  );
}

/** Step every chart on the page to its still shape: one-shot animations to
    their end, loops into GIFs when a store is given. The page's clock must
    be installed (page.clock.install) before the page loads. Never throws:
    a chart that fails stays as it is. */
export async function captureAnimatedCharts(
  page: Page,
  opts: {
    store: CaptureStore | null;
    deadline: number;
    // Reported as each chart is taken up, so the ingest card keeps moving
    // while the charts settle — the longest part of a render.
    onChart?: (n: number, total: number) => void;
  },
): Promise<CaptureResult> {
  const result: CaptureResult = { still: 0, settled: 0, looped: 0, undecided: 0 };
  const count = await markCharts(page);
  if (count === 0) return result;
  try {
    // Time stands still from here: the clock moves only by the steps below.
    await page.clock.pauseAt(Date.now() + 1000);
    const stillSamples = Math.ceil(STILL_MS / STEP_MS);
    const settleSamples = Math.ceil(SETTLE_MS / STEP_MS);
    for (let n = 0; n < count; n++) {
      if (Date.now() > opts.deadline) {
        result.undecided += count - n;
        break;
      }
      opts.onChart?.(n + 1, count);
      const chart = page.locator(`[${MARK}="${n}"]`);
      let kind: keyof CaptureResult = "undecided";
      const chartStartedAt = Date.now();
      let sampled = 0;
      let foundPeriod: number | null = null;
      try {
        // In view, so an animation that waits to be seen starts.
        await chart.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await startSampler(chart);
        const samples: Shape[] = [];
        let period: number | null = null;
        try {
          samples.push(...(await readSamples(page, 0)));
          while (samples.length < MAX_SAMPLES && Date.now() < opts.deadline) {
            const batch = Math.min(
              samples.length <= stillSamples ? stillSamples : SAMPLE_BATCH,
              MAX_SAMPLES - samples.length,
            );
            await page.clock.runFor(STEP_MS * batch);
            samples.push(...(await readSamples(page, samples.length)));
            const length = samples.length;
            if (length > stillSamples && samples.slice(0, stillSamples + 1).every((s) => sameShape(s, samples[0]))) {
              kind = "still";
              break;
            }
            if (length > settleSamples + 1) {
              const tail = samples.slice(length - settleSamples - 1);
              if (tail.every((s) => sameShape(s, tail[0]))) {
                kind = "settled";
                break;
              }
            }
            period = periodOf(samples);
            if (period !== null) break;
          }
        } finally {
          sampled = samples.length;
          foundPeriod = period;
          await stopSampler(page).catch(() => {});
        }
        if (period !== null && opts.store && result.looped < MAX_CHARTS) {
          const loop = await recordLoop(page, chart, period, opts.deadline);
          const gif = loop ? encodeWithinCap(loop.width, loop.height, loop.frames) : null;
          const src = gif ? await opts.store(gif) : null;
          if (loop && src) {
            await replaceWithImage(chart, src, loop.width, loop.height);
            kind = "looped";
          }
        }
      } catch (err) {
        // this chart stays as it is
        console.warn(`[capture] chart ${n} stays as it is:`, err);
      }
      result[kind] += 1;
      console.info(
        `[capture] chart ${n}: ${kind}, ${sampled} samples${foundPeriod ? `, period ${foundPeriod}` : ""}, ${Date.now() - chartStartedAt} ms`,
      );
    }
  } finally {
    await unmarkCharts(page).catch(() => {});
  }
  return result;
}
