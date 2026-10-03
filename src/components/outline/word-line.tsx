// One line of words that never cuts a word (SPEC.md §6): a collapsed row's
// title or gist. The words wrap to a second line that is never shown, so the
// line ends at the last whole word that fits — no ellipsis, no half word. A
// word in Chinese or Japanese script is cut between its characters, each a
// word of its own. A press on the row opens the note whole.

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** The line's units: each word with the space after it; in CJK script, each character. */
export function lineUnits(text: string): string[] {
  const units: string[] = [];
  for (const piece of text.replace(/\s+/g, " ").trim().match(/\S+\s*/g) ?? []) {
    if (CJK.test(piece)) units.push(...(piece.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]|[^぀-ヿ㐀-䶿一-鿿豈-﫿]+/g) ?? [piece]));
    else units.push(piece);
  }
  return units;
}

export function WordLine({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`flex h-[18px] flex-wrap overflow-hidden ${className ?? ""}`}>
      {lineUnits(text).map((unit, i) => (
        <span key={i} className="whitespace-pre">
          {unit}
        </span>
      ))}
    </span>
  );
}
