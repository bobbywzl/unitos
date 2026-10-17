#!/usr/bin/env node
// Fails when a tracked text file holds a merge conflict marker (REV5-02):
// `<<<<<<<` or `>>>>>>>` followed by a space or the line's end, anywhere on
// a line (a merge driver can leave them mid-line), and `=======` on a line
// of its own, or at a line's end, between such markers.
// Run: node scripts/qa/conflict-marker-check.mjs [repo dir]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);

const OPEN = /(^|\s)<{7}( |$)/;
const CLOSE = /(^|\s)>{7}( |$)/;
const MIDDLE = /(^|\s)={7}$/;

const found = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(join(root, file));
  } catch {
    continue; // deleted in the working tree
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const lines = buf.toString("utf8").split("\n");
  let open = false;
  lines.forEach((line, i) => {
    if (OPEN.test(line)) {
      found.push(`${file}:${i + 1}: <<<<<<<`);
      open = true;
    } else if (CLOSE.test(line)) {
      found.push(`${file}:${i + 1}: >>>>>>>`);
      open = false;
    } else if (open && MIDDLE.test(line)) {
      found.push(`${file}:${i + 1}: =======`);
    }
  });
}

if (found.length > 0) {
  console.error(`Conflict markers in ${new Set(found.map((f) => f.split(":")[0])).size} file(s):`);
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`No conflict markers in ${files.length} tracked files.`);
