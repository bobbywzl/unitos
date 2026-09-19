// pdf.js on Node 22 (SPEC.md §16): the runtime pdf.js needs before it loads.
// pdf.js's TrueType sanitizer sums glyph table sizes with Math.sumPrecise,
// which Node 22 does not have. Without it every embedded TrueType font fails
// to load, pdf.js warns and draws nothing for its text, and a vector
// figure's labels — matplotlib, Graphviz, Illustrator exports are TrueType
// — vanish from the rendered page while the Type 1 body text stays. Every
// file that loads unpdf imports this file first. Node 24 has the function;
// this install steps aside when it is there.
declare global {
  interface Math {
    sumPrecise?(values: Iterable<number>): number;
  }
}

// Neumaier's compensated sum: exact for the integer byte counts pdf.js
// sums, and within one rounding of the spec's result for anything else.
function sumPrecise(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const next = sum + value;
    compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
    sum = next;
  }
  return sum + compensation;
}

if (typeof Math.sumPrecise !== "function") {
  Math.sumPrecise = sumPrecise;
}

export {};
