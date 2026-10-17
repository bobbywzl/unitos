import * as ssf from "ssf";

// A sheet's formulas, computed the way the sheet computes them (SPEC.md
// §27). A formula's cell in a sheet's replica keeps its formula
// (`title="=…"`) and shows its value as the file stored it. When a cell it
// reads changes, or rows and columns come and go, the formula follows, as a
// spreadsheet does: its references move with their cells, and its value is
// computed again over the cells as they show. The reading covers numbers,
// text, TRUE and FALSE, a cell or a range, + - * / ^ & and comparisons, a
// percent, and SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND, ABS,
// and IF. A formula is computed only when this reading gives back its stored
// value in a format that shows it as it shows (`formulaFormat`); any other
// keeps its value, and its references move with their cells when they can.

export type CellValue = number | string | boolean | { error: string } | null;

type Node =
  | { k: "val"; v: CellValue }
  | { k: "ref"; r: number; c: number }
  | { k: "range"; r1: number; c1: number; r2: number; c2: number }
  | { k: "neg"; a: Node }
  | { k: "pct"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "fn"; name: string; args: Node[] };

/** A formula this reading does not cover. */
class Unsupported extends Error {}

// A reference, "A1" to "$XFD$1048576": its column letters and its row.
const REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;
const FUNCTIONS = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "PRODUCT", "ROUND", "ABS", "IF"]);

/** A column's index from its letters: A is 0. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A column's letters from its index: 0 is A. */
function letters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; r: number; c: number; start: number; end: number; colFixed: boolean; rowFixed: boolean }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "name"; v: string }
  | { t: "lp" | "rp" | "comma" | "colon" };

/** The formula's tokens (the text after "="), with each reference's place. */
function tokens(formula: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const rest = formula.slice(i);
    const ch = formula[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest);
    const ref = REF.exec(rest);
    if (ref && !/^[A-Za-z0-9_.(!]/.test(rest.slice(ref[0].length))) {
      out.push({ t: "ref", c: columnIndex(ref[2]), r: Number(ref[4]) - 1, start: i, end: i + ref[0].length, colFixed: ref[1] === "$", rowFixed: ref[3] === "$" });
      i += ref[0].length;
      continue;
    }
    if (number) {
      out.push({ t: "num", v: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= formula.length) throw new Unsupported("an open string");
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          break;
        }
        text += formula[j];
        j += 1;
      }
      out.push({ t: "str", v: text });
      i = j + 1;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (name) {
      const after = formula.slice(i + name[0].length).trimStart();
      out.push(after.startsWith("(") ? { t: "fn", v: name[0].toUpperCase() } : { t: "name", v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) out.push({ t: "op", v: ch });
    else if (ch === "(") out.push({ t: "lp" });
    else if (ch === ")") out.push({ t: "rp" });
    else if (ch === ",") out.push({ t: "comma" });
    else if (ch === ":") out.push({ t: "colon" });
    // A sheet's name, an error, an array, a table's column: not covered.
    else throw new Unsupported(ch);
    i += 1;
  }
  return out;
}

/** The formula read into a tree (Excel's precedence: a range, then a sign,
    a percent, ^, * and /, + and -, &, and the comparisons last). */
export function readFormula(formula: string): Node {
  const list = tokens(formula.replace(/^=/, ""));
  let at = 0;
  const peek = () => list[at];
  const take = () => list[at++];
  const isOp = (...ops: string[]) => {
    const t = peek();
    return t?.t === "op" && ops.includes(t.v);
  };
  const expect = (t: Token["t"]) => {
    if (peek()?.t !== t) throw new Unsupported(`${t} expected`);
    take();
  };
  const primary = (): Node => {
    const t = take();
    if (!t) throw new Unsupported("an end");
    switch (t.t) {
      case "num":
        return { k: "val", v: t.v };
      case "str":
        return { k: "val", v: t.v };
      case "ref": {
        if (peek()?.t !== "colon") return { k: "ref", r: t.r, c: t.c };
        take();
        const end = take();
        if (end?.t !== "ref") throw new Unsupported("a range");
        return { k: "range", r1: Math.min(t.r, end.r), c1: Math.min(t.c, end.c), r2: Math.max(t.r, end.r), c2: Math.max(t.c, end.c) };
      }
      case "name":
        if (t.v === "TRUE" || t.v === "FALSE") return { k: "val", v: t.v === "TRUE" };
        throw new Unsupported(t.v);
      case "fn": {
        if (!FUNCTIONS.has(t.v)) throw new Unsupported(t.v);
        expect("lp");
        const args: Node[] = [];
        if (peek()?.t !== "rp") {
          for (;;) {
            args.push(comparison());
            if (peek()?.t !== "comma") break;
            take();
          }
        }
        expect("rp");
        return { k: "fn", name: t.v, args };
      }
      case "lp": {
        const inner = comparison();
        expect("rp");
        return inner;
      }
      default:
        throw new Unsupported(t.t);
    }
  };
  const percent = (): Node => {
    let node = primary();
    while (isOp("%")) {
      take();
      node = { k: "pct", a: node };
    }
    return node;
  };
  const sign = (): Node => {
    if (isOp("-")) {
      take();
      return { k: "neg", a: sign() };
    }
    if (isOp("+")) {
      take();
      return sign();
    }
    return percent();
  };
  const binary = (next: () => Node, ...ops: string[]) => (): Node => {
    let node = next();
    while (isOp(...ops)) node = { k: "bin", op: (take() as { v: string }).v, a: node, b: next() };
    return node;
  };
  const power = binary(sign, "^");
  const product = binary(power, "*", "/");
  const sum = binary(product, "+", "-");
  const concat = binary(sum, "&");
  const comparison = binary(concat, "=", "<>", "<", ">", "<=", ">=");
  const tree = comparison();
  if (at !== list.length) throw new Unsupported("trailing tokens");
  return tree;
}

const isError = (v: CellValue): v is { error: string } => typeof v === "object" && v !== null;
const DIV0 = { error: "#DIV/0!" };
const VALUE = { error: "#VALUE!" };
const NUM = { error: "#NUM!" };

/** A value as a number, or the error it gives. */
function toNumber(v: CellValue): number | { error: string } {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isError(v)) return v;
  const n = cellValue(v);
  return typeof n === "number" ? n : VALUE;
}

/** A value as text, as & joins it. */
function toText(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return ssf.format("General", v);
  return isError(v) ? v.error : v;
}

/** Excel's ROUND: half away from zero. */
function round(x: number, digits: number): number {
  const f = 10 ** Math.trunc(digits);
  return (Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f;
}

/** The value of `node` over the cells `get` reads (null: an empty cell). */
function evaluate(node: Node, get: (r: number, c: number) => CellValue): CellValue {
  switch (node.k) {
    case "val":
      return node.v;
    case "ref":
      return get(node.r, node.c);
    case "range":
      throw new Unsupported("a range outside a function");
    case "neg": {
      const n = toNumber(evaluate(node.a, get));
      return isError(n) ? n : -n;
    }
    case "pct": {
      const n = toNumber(evaluate(node.a, get));
      return isError(n) ? n : n / 100;
    }
    case "bin": {
      const a = evaluate(node.a, get);
      const b = evaluate(node.b, get);
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (node.op === "&") return toText(a) + toText(b);
      if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
        const rank = (v: CellValue) => (typeof v === "number" || v === null ? 0 : typeof v === "string" ? 1 : 2);
        const x = a ?? (typeof b === "string" ? "" : 0);
        const y = b ?? (typeof a === "string" ? "" : 0);
        const order =
          rank(x) !== rank(y) ? rank(x) - rank(y)
          : typeof x === "string" && typeof y === "string" ? x.toLowerCase().localeCompare(y.toLowerCase())
          : Number(x) - Number(y);
        return { "=": order === 0, "<>": order !== 0, "<": order < 0, ">": order > 0, "<=": order <= 0, ">=": order >= 0 }[node.op] ?? false;
      }
      const x = toNumber(a);
      const y = toNumber(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (node.op === "/" && y === 0) return DIV0;
      const out = node.op === "+" ? x + y : node.op === "-" ? x - y : node.op === "*" ? x * y : node.op === "/" ? x / y : x ** y;
      return Number.isFinite(out) ? out : NUM;
    }
    case "fn":
      return call(node.name, node.args, get);
  }
}

/** A function's value. The aggregates read the numbers of their ranges and
    references (text, TRUE and FALSE, and empty cells left out) and take
    their other arguments as numbers. */
function call(name: string, args: Node[], get: (r: number, c: number) => CellValue): CellValue {
  const cells = (arg: Node): CellValue[] => {
    if (arg.k === "ref") return [get(arg.r, arg.c)];
    const out: CellValue[] = [];
    if (arg.k === "range") for (let r = arg.r1; r <= arg.r2; r++) for (let c = arg.c1; c <= arg.c2; c++) out.push(get(r, c));
    return out;
  };
  const numbers = (): number[] | { error: string } => {
    const out: number[] = [];
    for (const arg of args) {
      if (arg.k === "ref" || arg.k === "range") {
        for (const v of cells(arg)) {
          if (isError(v)) return v;
          if (typeof v === "number") out.push(v);
        }
        continue;
      }
      const n = toNumber(evaluate(arg, get));
      if (isError(n)) return n;
      out.push(n);
    }
    return out;
  };
  const scalar = (i: number): number | { error: string } => (args[i] ? toNumber(evaluate(args[i], get)) : 0);
  switch (name) {
    case "SUM":
    case "AVERAGE":
    case "MIN":
    case "MAX":
    case "PRODUCT":
    case "COUNT": {
      if (name === "COUNT") {
        let count = 0;
        for (const arg of args) {
          if (arg.k === "ref" || arg.k === "range") count += cells(arg).filter((v) => typeof v === "number").length;
          else if (typeof toNumber(evaluate(arg, get)) === "number") count += 1;
        }
        return count;
      }
      const list = numbers();
      if (!Array.isArray(list)) return list;
      if (name === "SUM") return list.reduce((a, b) => a + b, 0);
      if (name === "PRODUCT") return list.length === 0 ? 0 : list.reduce((a, b) => a * b, 1);
      if (name === "AVERAGE") return list.length === 0 ? DIV0 : list.reduce((a, b) => a + b, 0) / list.length;
      if (list.length === 0) return 0;
      return name === "MIN" ? Math.min(...list) : Math.max(...list);
    }
    case "COUNTA":
      return args.reduce((count, arg) => count + (arg.k === "ref" || arg.k === "range" ? cells(arg).filter((v) => v !== null && v !== "").length : 1), 0);
    case "ROUND": {
      const x = scalar(0);
      const d = scalar(1);
      if (isError(x)) return x;
      if (isError(d)) return d;
      return round(x, d);
    }
    case "ABS": {
      const x = scalar(0);
      return isError(x) ? x : Math.abs(x);
    }
    case "IF": {
      if (args.length < 2 || args.length > 3) throw new Unsupported("IF's arguments");
      const test = evaluate(args[0], get);
      if (isError(test)) return test;
      if (typeof test === "string") return VALUE;
      const yes = test === null ? false : typeof test === "number" ? test !== 0 : test;
      return yes ? evaluate(args[1], get) : args[2] ? evaluate(args[2], get) : false;
    }
    default:
      throw new Unsupported(name);
  }
}

/** A cell's value as it shows: a number (its grouping, currency, percent,
    and parentheses read), TRUE or FALSE, an error, text, or null when it
    is empty. */
export function cellValue(shown: string): CellValue {
  const text = shown.trim();
  if (text === "") return null;
  if (text === "TRUE" || text === "FALSE") return text === "TRUE";
  if (/^#(?:DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)$/.test(text)) return { error: text };
  const m = /^(\()?([-+])?([$€£¥])?([-+])?(\d{1,3}(?:,\d{3})+|\d*)(\.\d*)?(?:[eE]([-+]?\d+))?(%)?(\))?$/.exec(text.replace(/\u00a0/g, " ").replace(/ /g, ""));
  if (!m || (m[5] === "" && !m[6]) || Boolean(m[1]) !== Boolean(m[9])) return shown;
  const [, open, sign1, , sign2, int, dec, exp, pct] = m;
  let n = Number(`${int.replace(/,/g, "") || "0"}${dec ?? ""}${exp ? `e${exp}` : ""}`);
  if (!Number.isFinite(n)) return shown;
  if (pct) n /= 100;
  if (open || sign1 === "-" || sign2 === "-") n = -n;
  return n;
}

/** The format that shows `value` as `shown`, or null when none does: the
    cell's own (`hint`, the file's number format), else a number format read
    from the shown text (its grouping, decimals, currency, percent,
    parentheses for a negative) or General — the read one first when the
    text shows it (a trailing zero, a grouping, a percent, a currency). */
export function formulaFormat(shown: string, value: CellValue, hint: string | null = null): string | null {
  if (value === null) return shown === "" || shown === "0" ? "General" : null;
  if (typeof value !== "number") return toText(value) === shown ? "General" : null;
  const read: string[] = [];
  const m = /^\(?-?([$€£¥])?-?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%)?\)?$/.exec(shown.trim());
  if (m) {
    const [, currency, int, dec, pct] = m;
    const body = `${int.includes(",") ? "#,##0" : "0"}${dec ? `.${"0".repeat(dec.length)}` : ""}${pct ? "%" : ""}`;
    const positive = currency ? `"${currency}"${body}` : body;
    read.push(positive, `${positive};(${positive})`);
  }
  const shows_ = m && (m[1] || m[2].includes(",") || m[3]?.endsWith("0") || m[4] || shown.trim().startsWith("("));
  const tries = [...(hint ? [hint] : []), ...(shows_ ? [...read, "General"] : ["General", ...read])];
  return tries.find((code) => shows(code, value) === shown) ?? null;
}

/** A value shown in a format (General for anything but a number). */
export function shows(format: string, value: CellValue): string {
  if (typeof value !== "number") return toText(value);
  try {
    return ssf.format(format, value);
  } catch {
    return String(value);
  }
}

/** The formula's value over the cells, or null when this reading does not
    cover it. */
export function computeFormula(formula: string, get: (r: number, c: number) => CellValue): CellValue | undefined {
  try {
    return evaluate(readFormula(formula), get);
  } catch (error) {
    if (error instanceof Unsupported) return undefined;
    throw error;
  }
}

/** A shared formula as a cell below or beside its first cell reads it
    (ECMA-376 Part 1, §18.3.1.40): every reference not fixed with "$" moves
    by the cell's distance from the first cell, as a formula filled down or
    across does. The formula is given and returned without "=". Null when
    the reading does not cover it (another sheet's cells, an error) or a
    reference would move off the sheet. */
export function sharedFormula(formula: string, dr: number, dc: number): string | null {
  let list: Token[];
  try {
    list = tokens(formula);
  } catch {
    return null;
  }
  let out = formula;
  for (const t of [...list].reverse()) {
    if (t.t !== "ref") continue;
    const r = t.rowFixed ? t.r : t.r + dr;
    const c = t.colFixed ? t.c : t.c + dc;
    if (r < 0 || c < 0) return null;
    out = `${out.slice(0, t.start)}${t.colFixed ? "$" : ""}${letters(c)}${t.rowFixed ? "$" : ""}${r + 1}${out.slice(t.end)}`;
  }
  return out;
}

/** The formula with its references moved with their cells: `row` and `col`
    give an old row's or column's new index, or null for one that went. A
    range keeps the cells that stay (its ends move in to the nearest kept
    row or column inside it); null when a reference's cell went, or a
    range's every cell. */
export function movedFormula(formula: string, row: (r: number) => number | null, col: (c: number) => number | null): string | null {
  const body = formula.replace(/^=/, "");
  let list: Token[];
  try {
    list = tokens(body);
  } catch {
    return null;
  }
  const splices: { start: number; end: number; text: string }[] = [];
  const at = (map: (i: number) => number | null, i: number, toward: 1 | -1, limit: number): number | null => {
    for (let x = i; toward > 0 ? x <= limit : x >= limit; x += toward) {
      const mapped = map(x);
      if (mapped !== null) return mapped;
    }
    return null;
  };
  // A reference that stays where it was keeps its text.
  const write = (ref: Extract<Token, { t: "ref" }>, r: number, c: number) => {
    if (r !== ref.r || c !== ref.c) splices.push({ start: ref.start, end: ref.end, text: `${ref.colFixed ? "$" : ""}${letters(c)}${ref.rowFixed ? "$" : ""}${r + 1}` });
  };
  for (let k = 0; k < list.length; k++) {
    const t = list[k];
    if (t.t !== "ref") continue;
    const end = list[k + 1]?.t === "colon" ? list[k + 2] : undefined;
    if (end?.t === "ref") {
      const [r1, r2] = [Math.min(t.r, end.r), Math.max(t.r, end.r)];
      const [c1, c2] = [Math.min(t.c, end.c), Math.max(t.c, end.c)];
      const nr1 = at(row, r1, 1, r2);
      const nr2 = at(row, r2, -1, r1);
      const nc1 = at(col, c1, 1, c2);
      const nc2 = at(col, c2, -1, c1);
      if (nr1 === null || nr2 === null || nc1 === null || nc2 === null) return null;
      write(t, t.r <= end.r ? nr1 : nr2, t.c <= end.c ? nc1 : nc2);
      write(end, t.r <= end.r ? nr2 : nr1, t.c <= end.c ? nc2 : nc1);
      k += 2;
      continue;
    }
    const r = row(t.r);
    const c = col(t.c);
    if (r === null || c === null) return null;
    write(t, r, c);
  }
  let out = body;
  for (const s of splices.sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return `=${out}`;
}
