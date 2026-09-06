// An animated GIF from frames of RGBA pixels (lib/parse/capture-animation.ts:
// one loop of a chart the page's scripts animate). No dependency: the palette
// (the most frequent colors exact, median cut for the rest), the frame diff
// (each frame after the first writes only the box that changed, and inside
// it only the pixels that changed — the rest are transparent over what is
// already shown), the LZW, and the file are all here.

export type GifFrame = {
  // width × height × 4 bytes, row-major.
  rgba: Uint8ClampedArray | Uint8Array;
  // Shown for this long. Written in hundredths of a second, so 10 ms steps.
  delayMs: number;
};

// Colors in the palette by default: enough for a chart's flat fills and its
// text's edges; fewer colors compress smaller. 256 at most.
const DEFAULT_COLORS = 64;
// This share of the palette holds the most frequent colors at their exact
// values (a chart's fills, its text, its paper); median cut shares the rest
// of the palette among the other colors (antialiased edges, gradients).
const POPULAR_SHARE = 0.375;
// Pixels sampled per frame for the palette, at most.
const PALETTE_SAMPLE = 60_000;
// A pixel whose channels moved less than this in total since it was last
// written has not changed: a page's film grain or a renderer's dithering
// is noise, not motion.
const NOISE = 12;
const LZW_MAX_CODE = 4096;

type Box = { colors: number[]; counts: number[] };
type Rect = { left: number; top: number; width: number; height: number };

/** The channel with the widest range in a box, and the box's range. */
function widestChannel(box: Box): { shift: number; range: number } {
  let best = { shift: 16, range: -1 };
  for (const shift of [16, 8, 0]) {
    let min = 255;
    let max = 0;
    for (const color of box.colors) {
      const v = (color >> shift) & 0xff;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min > best.range) best = { shift, range: max - min };
  }
  return best;
}

/** Median cut: the colors, weighted by count, into at most `size` boxes;
    each box's weighted mean is one palette color. */
function medianCut(colors: number[], weights: number[], size: number): number[] {
  const first: Box = { colors, counts: weights };
  if (first.colors.length <= size) return first.colors;
  const boxes: Box[] = [first];
  while (boxes.length < size) {
    // Split the box holding the most pixels over the widest range; stop
    // when no box can split.
    let at = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      const { range } = widestChannel(boxes[i]);
      const weight = boxes[i].counts.reduce((sum, n) => sum + n, 0);
      const priority = weight * (range + 1);
      if (priority > best) {
        best = priority;
        at = i;
      }
    }
    if (at === -1) break;
    const box = boxes[at];
    const { shift } = widestChannel(box);
    const order = box.colors.map((_, i) => i).sort((a, b) => ((box.colors[a] >> shift) & 0xff) - ((box.colors[b] >> shift) & 0xff));
    const total = box.counts.reduce((sum, n) => sum + n, 0);
    let seen = 0;
    let cut = 0;
    for (; cut < order.length - 1; cut++) {
      seen += box.counts[order[cut]];
      if (seen * 2 >= total) break;
    }
    const lower = order.slice(0, cut + 1);
    const upper = order.slice(cut + 1);
    boxes[at] = { colors: lower.map((i) => box.colors[i]), counts: lower.map((i) => box.counts[i]) };
    boxes.push({ colors: upper.map((i) => box.colors[i]), counts: upper.map((i) => box.counts[i]) });
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < box.colors.length; i++) {
      const c = box.colors[i];
      const w = box.counts[i];
      r += ((c >> 16) & 0xff) * w;
      g += ((c >> 8) & 0xff) * w;
      b += (c & 0xff) * w;
      n += w;
    }
    return ((Math.round(r / n) & 0xff) << 16) | ((Math.round(g / n) & 0xff) << 8) | (Math.round(b / n) & 0xff);
  });
}

/** The frame's pixels as opaque RGB, 3 bytes each: a transparent pixel
    reads as white, the reader's paper. */
function opaqueRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let p = 0, o = 0; p < rgba.length; p += 4, o += 3) {
    const a = rgba[p + 3];
    if (a === 255) {
      out[o] = rgba[p];
      out[o + 1] = rgba[p + 1];
      out[o + 2] = rgba[p + 2];
      continue;
    }
    out[o] = Math.round(255 + ((rgba[p] - 255) * a) / 255);
    out[o + 1] = Math.round(255 + ((rgba[p + 1] - 255) * a) / 255);
    out[o + 2] = Math.round(255 + ((rgba[p + 2] - 255) * a) / 255);
  }
  return out;
}

/** The nearest palette color's index, cached per color. */
function paletteIndex(r: number, g: number, b: number, palette: number[], cache: Map<number, number>): number {
  const color = (r << 16) | (g << 8) | b;
  const cached = cache.get(color);
  if (cached !== undefined) return cached;
  let best = 0;
  let bestDistance = Infinity;
  for (let k = 0; k < palette.length; k++) {
    const c = palette[k];
    const dr = r - ((c >> 16) & 0xff);
    const dg = g - ((c >> 8) & 0xff);
    const db = b - (c & 0xff);
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k;
      if (distance === 0) break;
    }
  }
  cache.set(color, best);
  return best;
}

/** GIF's LZW over the indexes: the code stream, before it is cut into
    sub-blocks. minCodeSize is the palette's bits (2 at least). */
function lzwEncode(indexes: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let accumulator = 0;
  let bits = 0;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    accumulator |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(accumulator & 0xff);
      accumulator >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const byte = indexes[i];
    const key = (prefix << 8) | byte;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    emit(prefix);
    // The decoder widens its codes when the next code reaches the size's
    // limit: this side widens on the same count.
    if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    if (next < LZW_MAX_CODE) {
      table.set(key, next++);
    } else {
      emit(clear);
      table = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = byte;
  }
  emit(prefix);
  if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
  emit(end);
  if (bits > 0) out.push(accumulator & 0xff);
  return Uint8Array.from(out);
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: ArrayLike<number>) {
    const chunk = Uint8Array.from(bytes);
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  u16(n: number) {
    this.push([n & 0xff, (n >> 8) & 0xff]);
  }

  /** Data sub-blocks: 255 bytes at most each, then a zero-length block. */
  subBlocks(data: Uint8Array) {
    for (let at = 0; at < data.length; at += 255) {
      const slice = data.subarray(at, Math.min(at + 255, data.length));
      this.push([slice.length]);
      this.push(slice);
    }
    this.push([0]);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/** The pixels that moved past the noise since they were last shown, and
    the box around them; null when none did. */
function changesSince(shown: Uint8Array, rgb: Uint8Array, width: number, height: number): { changed: Uint8Array; box: Rect } | null {
  const changed = new Uint8Array(width * height);
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const o = p * 3;
      const moved = Math.abs(shown[o] - rgb[o]) + Math.abs(shown[o + 1] - rgb[o + 1]) + Math.abs(shown[o + 2] - rgb[o + 2]);
      if (moved < NOISE) continue;
      changed[p] = 1;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return bottom === -1 ? null : { changed, box: { left, top, width: right - left + 1, height: bottom - top + 1 } };
}

/** One looping GIF from the frames. Every frame is width × height; the
    palette holds `colors` colors (a power of two, 4 to 256). */
export function encodeGif(width: number, height: number, frames: GifFrame[], colors = DEFAULT_COLORS): Uint8Array {
  if (frames.length === 0) throw new Error("No frames");
  const paletteBits = Math.max(2, Math.min(8, Math.ceil(Math.log2(colors))));
  const paletteSize = 1 << paletteBits;
  // The last palette entry is the transparent index of the diff frames.
  const transparent = paletteSize - 1;
  const rgbFrames = frames.map((frame) => opaqueRgb(frame.rgba));
  // The palette: colors sampled across every frame, weighted by how often
  // they appear.
  const counts = new Map<number, number>();
  for (const rgb of rgbFrames) {
    const pixels = rgb.length / 3;
    const stride = Math.max(1, Math.floor(pixels / PALETTE_SAMPLE));
    for (let i = 0; i < pixels; i += stride) {
      const o = i * 3;
      const color = (rgb[o] << 16) | (rgb[o + 1] << 8) | rgb[o + 2];
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const byCount = [...counts].sort((a, b) => b[1] - a[1]);
  const popularCount = Math.round(paletteSize * POPULAR_SHARE);
  const popular = byCount.slice(0, popularCount).map(([color]) => color);
  const rest = byCount.slice(popularCount);
  const palette = [
    ...popular,
    ...medianCut(rest.map(([color]) => color), rest.map(([, n]) => n), transparent - popular.length),
  ];
  while (palette.length < paletteSize) palette.push(0);
  const opaque = palette.slice(0, transparent);

  const writer = new ByteWriter();
  writer.push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  writer.u16(width);
  writer.u16(height);
  writer.push([0xf0 | (paletteBits - 1), 0, 0]); // a global palette of 2^bits colors, 8 bits per channel
  for (const color of palette) writer.push([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]);
  // Loop forever.
  writer.push([0x21, 0xff, 0x0b]);
  writer.push([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]); // NETSCAPE2.0
  writer.push([0x03, 0x01, 0, 0, 0]);

  const writeFrame = (region: Uint8Array, box: Rect, delayMs: number, first: boolean) => {
    const delay = Math.max(1, Math.round(delayMs / 10));
    // Graphic control: leave the frame in place; after the first frame, the
    // transparent index shows what is already there.
    writer.push([0x21, 0xf9, 0x04, first ? 0x04 : 0x05]);
    writer.u16(delay);
    writer.push([first ? 0 : transparent, 0]);
    writer.push([0x2c]);
    writer.u16(box.left);
    writer.u16(box.top);
    writer.u16(box.width);
    writer.u16(box.height);
    writer.push([0]);
    writer.push([paletteBits]);
    writer.subBlocks(lzwEncode(region, paletteBits));
  };

  const cache = new Map<number, number>();
  // What the GIF shows after the frames written so far.
  const shown = new Uint8Array(width * height * 3);
  let written = 0;
  let lastDelayAt = -1;
  const delays: number[] = [];
  const pending: { region: Uint8Array; box: Rect }[] = [];
  rgbFrames.forEach((rgb, i) => {
    const first = written === 0;
    const changes = first ? null : changesSince(shown, rgb, width, height);
    if (!first && changes === null) {
      // A frame that changes nothing adds its time to the frame before it.
      delays[lastDelayAt] += frames[i].delayMs;
      return;
    }
    const box: Rect = changes ? changes.box : { left: 0, top: 0, width, height };
    const region = new Uint8Array(box.width * box.height);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const p = (box.top + y) * width + box.left + x;
        if (changes && changes.changed[p] === 0) {
          region[y * box.width + x] = transparent;
          continue;
        }
        const o = p * 3;
        region[y * box.width + x] = paletteIndex(rgb[o], rgb[o + 1], rgb[o + 2], opaque, cache);
        shown[o] = rgb[o];
        shown[o + 1] = rgb[o + 1];
        shown[o + 2] = rgb[o + 2];
      }
    }
    pending.push({ region, box });
    delays.push(frames[i].delayMs);
    lastDelayAt = delays.length - 1;
    written += 1;
  });
  pending.forEach((frame, i) => writeFrame(frame.region, frame.box, delays[i], i === 0));
  writer.push([0x3b]);
  return writer.bytes();
}
