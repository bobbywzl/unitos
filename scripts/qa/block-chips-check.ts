// Block tags side by side render as one chip with their count; a tag alone,
// or tags with words between them, stay one ¶ chip each.
// Run: npx tsx --tsconfig tsconfig.json scripts/qa/block-chips-check.ts
import { linkifyBlockTags } from "@/lib/block-tags";

let failed = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got:  ${got}\n     want: ${want}`}`);
}

check("one tag", linkifyBlockTags("the Evidence paragraph [block b5]."), "the Evidence paragraph [¶](#dissect-block-b5).");
check(
  "tags side by side",
  linkifyBlockTags("both Evidence paragraphs [block b5] [block b6]."),
  "both Evidence paragraphs [¶2](#dissect-blocks-b5,b6).",
);
check(
  "tags with commas",
  linkifyBlockTags("three lines [block a1], [block a2],[block a3] change."),
  "three lines [¶3](#dissect-blocks-a1,a2,a3) change.",
);
check("the same block twice", linkifyBlockTags("[block b5] [block b5]"), "[¶](#dissect-block-b5)");
check(
  "words between tags",
  linkifyBlockTags("the heading [block b1] and the paragraph [block b2]"),
  "the heading [¶](#dissect-block-b1) and the paragraph [¶](#dissect-block-b2)",
);
check("a note tag", linkifyBlockTags("the note [note n1] [block b2]"), "the note [✎](#dissect-note-n1) [¶](#dissect-block-b2)");

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
