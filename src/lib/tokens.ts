// An estimate of a text's tokens, for budgets (SPEC.md §22): Latin text at
// chars / 4, every CJK character (Han, kana, hangul, CJK punctuation,
// full-width forms) at 1. GLM and Kimi read Chinese at about 0.6–0.8 tokens
// per character, so the estimate errs high on Chinese, never low. A budget
// in these units costs the same on a Chinese project as on an English one.

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/g;

export function estTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}
