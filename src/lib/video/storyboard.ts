import { fetchPlayerResponse } from "@/lib/video/innertube";

// YouTube storyboard frames (SPEC.md §11). A YouTube frame cannot be captured
// from the player — the iframe is cross-origin — so the real frame at a moment
// comes from the storyboard sheets YouTube publishes for its scrubber preview.
// One sheet holds a grid of frames sampled every few seconds; this resolves a
// time to its sheet and the tile's rectangle inside it.

export type StoryboardFrame = {
  sheetUrl: string; // on i.ytimg.com; proxied to the client for canvas access
  x: number;
  y: number;
  width: number;
  height: number;
};

type Level = {
  width: number;
  height: number;
  frames: number;
  columns: number;
  rows: number;
  intervalMs: number;
  name: string;
  sigh: string;
};

// spec: "<url template>|<level>|<level>…", each level
// "w#h#frames#cols#rows#intervalMs#nameReplacement#sigh".
function parseSpec(spec: string): { template: string; levels: Level[] } | null {
  const parts = spec.split("|");
  if (parts.length < 2) return null;
  const levels: Level[] = [];
  for (const raw of parts.slice(1)) {
    const f = raw.split("#");
    if (f.length < 8) continue;
    const level: Level = {
      width: Number(f[0]),
      height: Number(f[1]),
      frames: Number(f[2]),
      columns: Number(f[3]),
      rows: Number(f[4]),
      intervalMs: Number(f[5]),
      name: f[6],
      sigh: f[7],
    };
    // Level 0 is the single default thumbnail: no interval, nothing to seek in.
    if (
      level.intervalMs > 0 &&
      level.columns > 0 &&
      level.rows > 0 &&
      level.width > 0 &&
      level.height > 0
    ) {
      levels.push(level);
    }
  }
  return levels.length > 0 ? { template: parts[0], levels } : null;
}

// The storyboard spec is stable for a video; the player call behind it is not
// free, and one Visual strip asks for several frames at once.
const specCache = new Map<string, { spec: string; at: number }>();
const SPEC_TTL_MS = 30 * 60 * 1000;

async function storyboardSpec(youtubeId: string): Promise<string | null> {
  const hit = specCache.get(youtubeId);
  if (hit && Date.now() - hit.at < SPEC_TTL_MS) return hit.spec;
  const { data } = await fetchPlayerResponse(youtubeId);
  const spec = data.storyboards?.playerStoryboardSpecRenderer?.spec;
  if (!spec) return null;
  specCache.set(youtubeId, { spec, at: Date.now() });
  return spec;
}

export async function storyboardFrame(
  youtubeId: string,
  timeSeconds: number,
): Promise<StoryboardFrame | null> {
  const spec = await storyboardSpec(youtubeId);
  if (!spec) return null;
  const parsed = parseSpec(spec);
  if (!parsed) return null;

  // The last level is the largest tile — the most detail available.
  const index = parsed.levels.length - 1;
  const level = parsed.levels[index];
  const perSheet = level.columns * level.rows;
  const frame = Math.max(
    0,
    Math.min(Math.floor((timeSeconds * 1000) / level.intervalMs), level.frames - 1),
  );
  const sheet = Math.floor(frame / perSheet);
  const withinSheet = frame % perSheet;
  const sheetUrl =
    parsed.template
      .replace("$L", String(index))
      .replace("$N", level.name)
      .replace("$M", String(sheet)) + `&sigh=${level.sigh}`;
  if (new URL(sheetUrl).hostname !== "i.ytimg.com") return null;
  return {
    sheetUrl,
    x: (withinSheet % level.columns) * level.width,
    y: Math.floor(withinSheet / level.columns) * level.height,
    width: level.width,
    height: level.height,
  };
}
