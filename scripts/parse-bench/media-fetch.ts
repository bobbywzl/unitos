// The media benchmark's downloads (scripts/parse-bench/media.mts --fetch):
// every file in media-corpus.json into .bench/media/files/<id>, then the
// references (media-ref.py, and the WebVTT references media.mts builds).
// Other people's files: they stay in .bench/ and are never committed.
//
//   npx tsx scripts/parse-bench/media-fetch.ts [--force]
//
// A raw source is a URL prefix; a pypi source is a member of the package's
// source archive (the test data ships in it). A derived file is made here
// from a fetched one with ffmpeg; the corpus says how.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MEDIA_ROOT = join(import.meta.dirname, "..", "..", ".bench", "media");
export const FILES = join(MEDIA_ROOT, "files");
const ARCHIVES = join(MEDIA_ROOT, "archives");

export type CorpusFile = {
  id: string;
  section: "a" | "b" | "c";
  source?: string;
  path?: string;
  format?: string;
  reference?: string;
  derived?: { from: string; args: string[]; how: string };
  exercises: string;
};
type Source = { from: string; root?: string; license: string; home: string };
export type Corpus = { sources: Record<string, Source>; files: CorpusFile[] };

export const corpus: Corpus = JSON.parse(readFileSync(join(import.meta.dirname, "media-corpus.json"), "utf8"));

export const fileOf = (id: string) => join(FILES, id);
export const referenceOf = (id: string) => join(FILES, `${id}.reference`);

function curl(url: string, out: string) {
  execFileSync("curl", ["-sSfL", "--retry", "2", "-o", out, url], { stdio: ["ignore", "ignore", "pipe"] });
}

// A pypi source archive, downloaded once.
function sdist(spec: string): string {
  const [name, version] = spec.replace(/^pypi:/, "").split("==");
  const out = join(ARCHIVES, `${name}-${version}.tar.gz`);
  if (existsSync(out)) return out;
  const meta = JSON.parse(
    execFileSync("curl", ["-sSfL", `https://pypi.org/pypi/${name}/${version}/json`], { encoding: "utf8" }),
  ) as { urls: { packagetype: string; url: string }[] };
  const url = meta.urls.find((u) => u.packagetype === "sdist")?.url;
  if (!url) throw new Error(`${name} ${version} has no source archive`);
  curl(url, out);
  return out;
}

function member(archive: string, path: string, out: string) {
  const tmp = join(ARCHIVES, "x");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["xzf", archive, "-C", tmp, path]);
  renameSync(join(tmp, path), out);
  rmSync(tmp, { recursive: true, force: true });
}

function fetchOne(file: CorpusFile, path: string, out: string) {
  const source = corpus.sources[file.source!];
  if (source.from.startsWith("pypi:")) member(sdist(source.from), `${source.root}${path}`, out);
  else curl(`${source.from}${path.split("/").map(encodeURIComponent).join("/")}`, out);
}

export function fetchAll(force = false) {
  mkdirSync(FILES, { recursive: true });
  mkdirSync(ARCHIVES, { recursive: true });
  const failed: string[] = [];
  for (const file of corpus.files) {
    const out = fileOf(file.id);
    try {
      if (force || !existsSync(out)) {
        if (file.derived) derive(file, out);
        else fetchOne(file, file.path!, out);
      }
      if (file.reference && (force || !existsSync(referenceOf(file.id)))) fetchOne(file, file.reference, referenceOf(file.id));
    } catch (err) {
      failed.push(`${file.id}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }
  const sizes = corpus.files.filter((f) => existsSync(fileOf(f.id))).map((f) => statSync(fileOf(f.id)).size);
  console.log(`${sizes.length} of ${corpus.files.length} files on disk, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB`);
  for (const f of failed) console.log(`  not fetched: ${f}`);
}

// A derived file: ffmpeg's DASH muxer writes one indexed fragmented MP4 (init,
// sidx, then moof+mdat segments); the corpus names the muxer's options.
function derive(file: CorpusFile, out: string) {
  const from = fileOf(file.derived!.from);
  if (!existsSync(from)) throw new Error(`${file.derived!.from} is not fetched`);
  const dir = join(MEDIA_ROOT, "derive");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync(
    "ffmpeg",
    ["-loglevel", "error", "-i", from, ...file.derived!.args, join(dir, "out.mpd")],
    { stdio: "inherit" },
  );
  const made = execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").find((n) => n.endsWith(".mp4") || n.endsWith(".m4s"));
  if (!made) throw new Error("ffmpeg wrote no stream");
  renameSync(join(dir, made), out);
  writeFileSync(join(MEDIA_ROOT, "derive.log"), `${file.id} from ${made}\n`);
  rmSync(dir, { recursive: true, force: true });
}

if (process.argv[1]?.endsWith("media-fetch.ts")) fetchAll(process.argv.includes("--force"));
