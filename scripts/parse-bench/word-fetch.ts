// The Word benchmark's downloads (scripts/parse-bench/word.mts): every file
// in word-corpus.json into .bench/word/files/<name>, and
// .bench/word/manifest.json naming each file's source and license. Other
// people's files: they stay in .bench/ and are never committed.
//
//   npx tsx scripts/parse-bench/word-fetch.ts [--force] [--only name,name]
//
// A repository source is a file at a pinned commit (raw.githubusercontent.com);
// an npm source is a member of the package's tarball at a pinned version.
// Each file's sha256 is in the corpus: a file that comes back otherwise is
// reported and not kept, so a set rebuilt later is the set the baseline
// counted.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORD_ROOT = join(import.meta.dirname, "..", "..", ".bench", "word");
const FILES = join(WORD_ROOT, "files");
const ARCHIVES = join(WORD_ROOT, "archives");
const CORPUS = join(import.meta.dirname, "word-corpus.json");

type Source = { repo?: string; commit?: string; npm?: string; license: string; what: string };
type CorpusFile = { name: string; source: string; path: string; sha256?: string; covers?: string[] };
type Corpus = { sources: Record<string, Source>; files: CorpusFile[] };

const corpus = JSON.parse(readFileSync(CORPUS, "utf8")) as Corpus;

function curl(url: string, out: string) {
  execFileSync("curl", ["-sSfL", "--retry", "4", "--retry-all-errors", "--retry-delay", "2", "--connect-timeout", "20", "--max-time", "300", "-o", out, url], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// An npm package's tarball, downloaded once, unpacked once.
function npmPackage(spec: string): string {
  const at = spec.lastIndexOf("@");
  const [name, version] = [spec.slice(0, at), spec.slice(at + 1)];
  const dir = join(ARCHIVES, `${name}-${version}`);
  if (existsSync(dir)) return dir;
  const tgz = `${dir}.tgz`;
  if (!existsSync(tgz)) curl(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, tgz);
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["xzf", tgz, "-C", tmp]);
  renameSync(tmp, dir);
  return dir;
}

function fetchOne(file: CorpusFile, out: string) {
  const source = corpus.sources[file.source];
  if (!source) throw new Error(`no source ${file.source}`);
  const tmp = `${out}.part`;
  if (source.npm) {
    const dir = npmPackage(source.npm);
    writeFileSync(tmp, readFileSync(join(dir, file.path)));
  } else if (source.repo && source.commit) {
    curl(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${file.path.split("/").map(encodeURIComponent).join("/")}`, tmp);
  } else throw new Error(`source ${file.source} names no repository or package`);
  const sum = sha256(tmp);
  if (file.sha256 && sum !== file.sha256) {
    rmSync(tmp);
    throw new Error(`sha256 ${sum.slice(0, 12)}…, the corpus has ${file.sha256.slice(0, 12)}…`);
  }
  renameSync(tmp, out);
}

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1]?.split(",") : undefined;

mkdirSync(FILES, { recursive: true });
mkdirSync(ARCHIVES, { recursive: true });
const failed: string[] = [];
let fetched = 0;
for (const file of corpus.files) {
  if (only && !only.includes(file.name)) continue;
  const out = join(FILES, file.name);
  if (!force && existsSync(out) && (!file.sha256 || sha256(out) === file.sha256)) continue;
  try {
    fetchOne(file, out);
    fetched++;
  } catch (err) {
    failed.push(`${file.name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}
const manifest = corpus.files.map((f) => {
  const s = corpus.sources[f.source];
  return { name: f.name, from: s.npm ? `npm ${s.npm}` : `${s.repo}@${s.commit}`, path: f.path, license: s.license };
});
writeFileSync(join(WORD_ROOT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
const onDisk = corpus.files.filter((f) => existsSync(join(FILES, f.name))).length;
console.log(`${fetched} fetched; ${onDisk} of ${corpus.files.length} files on disk in ${FILES}`);
for (const f of failed) console.log(`  not fetched: ${f}`);
if (failed.length > 0) process.exitCode = 1;
