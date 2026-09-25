import type { Node as PMNode } from "@tiptap/pm/model";
import { charClass } from "@/components/docs/typing/chars";

// Google Docs' word count (SPEC.md §29, typing): a word is a run of word
// characters; an apostrophe, a hyphen, or a dash never splits one; any
// punctuation does. Characters leave out paragraph ends, and "excluding
// spaces" leaves out the space character alone.

export type Counts = { words: number; chars: number; charsNoSpaces: number };

/** Google Docs' counts over [from, to) of the document. */
export function countRange(doc: PMNode, from: number, to: number): Counts {
  let words = 0;
  let chars = 0;
  let charsNoSpaces = 0;
  let inWord = false;
  const see = (ch: string) => {
    chars++;
    if (ch !== " ") charsNoSpaces++;
    const cls = charClass(ch);
    if (cls === "t") return;
    const word = cls === "w";
    if (word && !inWord) words++;
    inWord = word;
  };
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      inWord = false;
      return true;
    }
    if (node.isText) {
      const text = node.text ?? "";
      for (const ch of text.slice(Math.max(0, from - pos), Math.max(0, to - pos))) see(ch);
      return false;
    }
    if (node.type.name === "hardBreak") {
      chars++;
      charsNoSpaces++;
      inWord = false;
    }
    return true;
  });
  return { words, chars, charsNoSpaces };
}
