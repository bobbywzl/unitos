import { z } from "zod";
import { ACCENT, ACCENTS, escapeXml, INK, MUTED, PAPER, THEME_STYLE } from "@/lib/derive/visual-palette";

// VISUALIZE's simulation (SPEC.md §20): an equation of motion shown as the
// state it governs evolving through time. The model gives the law, the
// domain, the state at t = 0, the boundary, the coefficient, and the time
// the picture covers; the server integrates the equation and draws the
// frames as one SMIL animation. The model never writes a frame — it could
// not write a true one — so what the reader sees is the equation itself,
// solved, in the way a textbook animates the heat equation or a wave packet.

// ── Formulas ───────────────────────────────────────────────────────────────
// A small expression language for the model's formulas: numbers, the
// variables the law offers, + - * / ^, unary minus, parentheses, comparisons
// (1 or 0), and a fixed set of functions. Parsed once, evaluated many times;
// never eval.

export type Formula = (vars: Record<string, number>) => number;

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  // 1 from 0 on, else 0; 1 on [a, b), else 0. Square pulses and steps.
  step: (x) => (x >= 0 ? 1 : 0),
  pulse: (x, a, b) => (x >= a && x < b ? 1 : 0),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`a number is malformed at "${src.slice(i, i + 6)}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["**", "<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two === "**" ? "^" : two });
      i += 2;
      continue;
    }
    if ("+-*/^(),<>".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`"${c}" is not part of a formula`);
  }
  return out;
}

/** The formula compiled: throws with the reason when it does not parse or
    names something the law does not offer. */
export function compileFormula(source: string, variables: string[]): Formula {
  const toks = tokenize(source);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const take = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}" in "${source}"`);
    pos++;
  };
  const known = new Set(variables);

  const primary = (): Formula => {
    const tok = peek();
    if (!tok) throw new Error(`"${source}" ends early`);
    if (tok.t === "num") {
      pos++;
      const v = tok.v;
      return () => v;
    }
    if (tok.t === "id") {
      pos++;
      if (isOp("(")) {
        const fn = FUNCS[tok.v];
        if (!fn) throw new Error(`"${tok.v}" is not a function the formula can use`);
        pos++;
        const args: Formula[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            pos++;
            args.push(expr());
          }
        }
        take(")");
        return (vars) => fn(...args.map((a) => a(vars)));
      }
      if (known.has(tok.v)) {
        const name = tok.v;
        return (vars) => vars[name];
      }
      if (tok.v in CONSTS) {
        const v = CONSTS[tok.v];
        return () => v;
      }
      throw new Error(`"${tok.v}" is not a variable here (use ${variables.join(", ")})`);
    }
    if (isOp("(")) {
      pos++;
      const inner = expr();
      take(")");
      return inner;
    }
    throw new Error(`unexpected "${tok.v}" in "${source}"`);
  };
  const power = (): Formula => {
    const base = primary();
    if (isOp("^")) {
      pos++;
      const exponent = unary();
      return (vars) => Math.pow(base(vars), exponent(vars));
    }
    return base;
  };
  const unary = (): Formula => {
    if (isOp("-")) {
      pos++;
      const inner = unary();
      return (vars) => -inner(vars);
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };
  const mul = (): Formula => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = peek().v;
      pos++;
      const right = unary();
      const l = left;
      left = op === "*" ? (vars) => l(vars) * right(vars) : (vars) => l(vars) / right(vars);
    }
    return left;
  };
  const add = (): Formula => {
    let left = mul();
    while (isOp("+") || isOp("-")) {
      const op = peek().v;
      pos++;
      const right = mul();
      const l = left;
      left = op === "+" ? (vars) => l(vars) + right(vars) : (vars) => l(vars) - right(vars);
    }
    return left;
  };
  const cmp = (): Formula => {
    const left = add();
    for (const op of ["<=", ">=", "==", "!=", "<", ">"]) {
      if (isOp(op)) {
        pos++;
        const right = add();
        const test: Record<string, (a: number, b: number) => boolean> = {
          "<=": (a, b) => a <= b,
          ">=": (a, b) => a >= b,
          "==": (a, b) => a === b,
          "!=": (a, b) => a !== b,
          "<": (a, b) => a < b,
          ">": (a, b) => a > b,
        };
        const f = test[op];
        return (vars) => (f(left(vars), right(vars)) ? 1 : 0);
      }
    }
    return left;
  };
  const and = (): Formula => {
    let left = cmp();
    while (isOp("&&")) {
      pos++;
      const right = cmp();
      const l = left;
      left = (vars) => (l(vars) !== 0 && right(vars) !== 0 ? 1 : 0);
    }
    return left;
  };
  const expr = (): Formula => {
    let left = and();
    while (isOp("||")) {
      pos++;
      const right = and();
      const l = left;
      left = (vars) => (l(vars) !== 0 || right(vars) !== 0 ? 1 : 0);
    }
    return left;
  };

  const compiled = expr();
  if (pos < toks.length) throw new Error(`"${source}" has more after the formula ends`);
  return compiled;
}

// ── The contract ───────────────────────────────────────────────────────────

const formula = z.string().min(1).max(300);

export const simulationSchema = z.object({
  law: z.enum(["heat", "wave", "advection", "schrodinger", "ode"]),
  // The law as the passage writes it, shown above the plot.
  equation: z.string().max(80).nullish(),
  // Space, for a field law: x from x0 to x1.
  x0: z.number().default(0),
  x1: z.number().default(1),
  // The state at t = 0, a formula in x. For schrodinger the amplitude: the
  // state is initial(x) · e^{i·momentum·x}.
  initial: formula.nullish(),
  // wave: the initial velocity ∂u/∂t at t = 0, a formula in x. Default 0.
  velocity: formula.nullish(),
  // schrodinger: the potential V(x), a formula in x. Default 0.
  potential: formula.nullish(),
  momentum: z.number().default(0),
  // fixed: the ends hold their t = 0 values. insulated: no flux through the
  // ends. periodic: the ends are one point.
  boundary: z.enum(["fixed", "insulated", "periodic"]).default("fixed"),
  // heat: α. wave: c. advection: c, positive moves right. schrodinger: ħ/2m.
  coefficient: z.number().default(1),
  // ode: the variables, each with its rate dv/dt as a formula in t and every
  // variable's name, and its value at t = 0.
  variables: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(12),
        rate: formula,
        start: z.number(),
      }),
    )
    .min(1)
    .max(4)
    .nullish(),
  // The time the animation covers, in the law's units.
  duration: z.number().positive().max(1e9),
  xLabel: z.string().max(40).nullish(),
  uLabel: z.string().max(40).nullish(),
});

export type Simulation = z.infer<typeof simulationSchema>;

// ── Integration ────────────────────────────────────────────────────────────

const FRAMES = 36; // over the loop's 8 seconds
const POINTS = 96;
const POINTS_WAVEFUNCTION = 128;
const LOOP_SECONDS = 8;

type Field = { x: number[]; frames: number[][] };

function grid(sim: Simulation, n: number): number[] {
  const { x0, x1, boundary } = sim;
  // Periodic: x1 is x0 again, so the last point stops one step short.
  const span = boundary === "periodic" ? n : n - 1;
  return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / span);
}

function sample(f: Formula, x: number[], what: string): number[] {
  return x.map((xi) => {
    const v = f({ x: xi });
    if (!Number.isFinite(v)) throw new Error(`${what} is not finite at x = ${xi.toPrecision(3)}`);
    return v;
  });
}

/** Thomas: the tridiagonal system. lower[i] sits left of diag[i] (i ≥ 1),
    upper[i] right of it (i ≤ n − 2). */
function tridiagonal(lower: number[], diag: number[], upper: number[], rhs: number[]): number[] {
  const n = rhs.length;
  const c = new Array<number>(n);
  const d = new Array<number>(n);
  c[0] = upper[0] / diag[0];
  d[0] = rhs[0] / diag[0];
  for (let i = 1; i < n; i++) {
    const m = diag[i] - lower[i] * c[i - 1];
    c[i] = (i < n - 1 ? upper[i] : 0) / m;
    d[i] = (rhs[i] - lower[i] * d[i - 1]) / m;
  }
  const out = new Array<number>(n);
  out[n - 1] = d[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = d[i] - c[i] * out[i + 1];
  return out;
}

/** The heat equation u_t = α u_xx. Crank–Nicolson on a fixed or insulated
    domain, stable at any step; explicit on a periodic one. */
function heat(sim: Simulation): Field {
  const x = grid(sim, POINTS);
  const dx = x[1] - x[0];
  const alpha = Math.abs(sim.coefficient) || 1;
  const u0 = sample(compileFormula(sim.initial!, ["x"]), x, "The initial state");
  const frames: number[][] = [u0.slice()];
  const frameDt = sim.duration / (FRAMES - 1);
  let u = u0.slice();
  const n = x.length;
  if (sim.boundary === "periodic") {
    const dt = (0.4 * dx * dx) / alpha;
    const sub = Math.ceil(frameDt / dt);
    if (sub * (FRAMES - 1) > 400_000) {
      throw new Error("The duration is too long for this α on a periodic domain; shorten it");
    }
    const r = (alpha * (frameDt / sub)) / (dx * dx);
    for (let k = 1; k < FRAMES; k++) {
      for (let s = 0; s < sub; s++) {
        const next = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          next[i] = u[i] + r * (u[(i + 1) % n] - 2 * u[i] + u[(i - 1 + n) % n]);
        }
        u = next;
      }
      frames.push(u.slice());
    }
    return { x, frames };
  }
  // Substeps keep r moderate: Crank–Nicolson is stable at any r but rings on
  // sharp starts when r is large.
  const rFrame = (alpha * frameDt) / (dx * dx);
  const sub = Math.min(400, Math.max(2, Math.ceil(rFrame / 4)));
  const r = rFrame / sub;
  const insulated = sim.boundary === "insulated";
  const lower = new Array<number>(n).fill(-r / 2);
  const diag = new Array<number>(n).fill(1 + r);
  const upper = new Array<number>(n).fill(-r / 2);
  if (insulated) {
    // The mirror ghost point: the one neighbour counts twice.
    upper[0] = -r;
    lower[n - 1] = -r;
  } else {
    // The ends hold their t = 0 value: identity rows.
    diag[0] = diag[n - 1] = 1;
    upper[0] = lower[n - 1] = 0;
  }
  for (let k = 1; k < FRAMES; k++) {
    for (let s = 0; s < sub; s++) {
      const rhs = new Array<number>(n);
      for (let i = 1; i < n - 1; i++) {
        rhs[i] = (r / 2) * u[i - 1] + (1 - r) * u[i] + (r / 2) * u[i + 1];
      }
      if (insulated) {
        rhs[0] = (1 - r) * u[0] + r * u[1];
        rhs[n - 1] = (1 - r) * u[n - 1] + r * u[n - 2];
      } else {
        rhs[0] = u0[0];
        rhs[n - 1] = u0[n - 1];
      }
      u = tridiagonal(lower, diag, upper, rhs);
    }
    frames.push(u.slice());
  }
  return { x, frames };
}

/** The wave equation u_tt = c² u_xx: leapfrog, within the CFL bound. */
function wave(sim: Simulation): Field {
  const x = grid(sim, POINTS);
  const dx = x[1] - x[0];
  const c = Math.abs(sim.coefficient) || 1;
  const u0 = sample(compileFormula(sim.initial!, ["x"]), x, "The initial state");
  const v0 = sim.velocity
    ? sample(compileFormula(sim.velocity, ["x"]), x, "The initial velocity")
    : new Array<number>(x.length).fill(0);
  const frameDt = sim.duration / (FRAMES - 1);
  const sub = Math.max(1, Math.ceil((c * frameDt) / (0.8 * dx)));
  if (sub * (FRAMES - 1) > 400_000) {
    throw new Error("The wave crosses the domain too many times in this duration; shorten it");
  }
  const dt = frameDt / sub;
  const C2 = ((c * dt) / dx) ** 2;
  const n = x.length;
  const periodic = sim.boundary === "periodic";
  const insulated = sim.boundary === "insulated";
  const at = (u: number[], i: number) => {
    if (i >= 0 && i < n) return u[i];
    if (periodic) return u[(i + n) % n];
    if (insulated) return u[i < 0 ? -i : 2 * (n - 1) - i];
    return i < 0 ? u0[0] : u0[n - 1];
  };
  const lap = (u: number[], i: number) => at(u, i + 1) - 2 * u[i] + at(u, i - 1);
  let prev = u0.slice();
  // The first step from the velocity: u¹ = u⁰ + dt·v + ½C²·Δu⁰.
  let u = u0.map((ui, i) => ui + dt * v0[i] + (C2 / 2) * lap(u0, i));
  const pin = (arr: number[]) => {
    if (!periodic && !insulated) {
      arr[0] = u0[0];
      arr[n - 1] = u0[n - 1];
    }
  };
  pin(u);
  const frames: number[][] = [u0.slice()];
  let stepsDone = 1;
  for (let k = 1; k < FRAMES; k++) {
    while (stepsDone < k * sub) {
      const next = u.map((ui, i) => 2 * ui - prev[i] + C2 * lap(u, i));
      pin(next);
      prev = u;
      u = next;
      stepsDone++;
    }
    frames.push(u.slice());
  }
  return { x, frames };
}

/** Advection u_t + c u_x = 0: the exact solution, u(x, t) = u₀(x − ct), so a
    pulse travels without the smear a difference scheme adds. */
function advection(sim: Simulation): Field {
  const x = grid(sim, POINTS);
  const c = sim.coefficient;
  const f = compileFormula(sim.initial!, ["x"]);
  const L = sim.x1 - sim.x0;
  const frames: number[][] = [];
  for (let k = 0; k < FRAMES; k++) {
    const t = (sim.duration * k) / (FRAMES - 1);
    frames.push(
      x.map((xi) => {
        let xs = xi - c * t;
        if (sim.boundary === "periodic") xs = sim.x0 + ((((xs - sim.x0) % L) + L) % L);
        const v = f({ x: xs });
        if (!Number.isFinite(v)) throw new Error(`The initial state is not finite at x = ${xs.toPrecision(3)}`);
        return v;
      }),
    );
  }
  return { x, frames };
}

/** The Schrödinger equation i ψ_t = −a ψ_xx + V ψ (ħ = 1, a = ħ/2m):
    Crank–Nicolson in the complex plane, on a box (the ends hold ψ = 0) or an
    insulated domain. Returns |ψ|² as the frames and Re ψ beside it. */
function schrodinger(sim: Simulation): Field & { real: number[][]; potential: number[] } {
  const x = grid({ ...sim, boundary: sim.boundary === "periodic" ? "fixed" : sim.boundary }, POINTS_WAVEFUNCTION);
  const dx = x[1] - x[0];
  const a = Math.abs(sim.coefficient) || 1;
  const amp = sample(compileFormula(sim.initial!, ["x"]), x, "The initial amplitude");
  const V = sim.potential
    ? sample(compileFormula(sim.potential, ["x"]), x, "The potential")
    : new Array<number>(x.length).fill(0);
  const n = x.length;
  const k0 = sim.momentum;
  let re = amp.map((A, i) => A * Math.cos(k0 * x[i]));
  let im = amp.map((A, i) => A * Math.sin(k0 * x[i]));
  const insulated = sim.boundary === "insulated";
  if (!insulated) {
    re[0] = re[n - 1] = 0;
    im[0] = im[n - 1] = 0;
  }
  const frameDt = sim.duration / (FRAMES - 1);
  const sub = Math.min(400, Math.max(2, Math.ceil((a * frameDt) / (dx * dx) / 2)));
  const dt = frameDt / sub;
  // A = i·dt·a/(2dx²): the off-diagonal of the implicit half.
  const A = (dt * a) / (2 * dx * dx);
  const density = () => re.map((r, i) => r * r + im[i] * im[i]);
  const frames = [density()];
  const real = [re.slice()];
  for (let k = 1; k < FRAMES; k++) {
    for (let s = 0; s < sub; s++) {
      // rhs = ψ(1 − 2iA − i·dt·V/2) + iA(ψ₊ + ψ₋); solve (1 + 2iA + i·dt·V/2)ψ' − iA(ψ'₊ + ψ'₋) = rhs.
      const rr = new Array<number>(n);
      const ri = new Array<number>(n);
      const at = (arr: number[], i: number) => {
        if (i >= 0 && i < n) return arr[i];
        return insulated ? arr[i < 0 ? -i : 2 * (n - 1) - i] : 0;
      };
      for (let i = 0; i < n; i++) {
        const w = (dt * V[i]) / 2;
        // ψ · (1 − i(2A + w)) = (re + im(2A+w)) + i(im − re(2A+w))
        const nr = at(re, i + 1) + at(re, i - 1);
        const ni = at(im, i + 1) + at(im, i - 1);
        rr[i] = re[i] + im[i] * (2 * A + w) - A * ni;
        ri[i] = im[i] - re[i] * (2 * A + w) + A * nr;
      }
      // Complex Thomas with diag 1 + i(2A + w_i), off-diagonals −iA.
      const cr = new Array<number>(n);
      const ci = new Array<number>(n);
      const dr = new Array<number>(n);
      const di = new Array<number>(n);
      const div = (xr: number, xi: number, yr: number, yi: number) => {
        const m = yr * yr + yi * yi;
        return [(xr * yr + xi * yi) / m, (xi * yr - xr * yi) / m];
      };
      const diagAt = (i: number) => [1, 2 * A + (dt * V[i]) / 2] as const;
      // Insulated ends see their neighbour twice; fold by doubling the coupling.
      const offUp = (i: number) => (insulated && i === 0 ? -2 * A : -A);
      const offLow = (i: number) => (insulated && i === n - 1 ? -2 * A : -A);
      {
        const [pr, pi] = diagAt(0);
        [cr[0], ci[0]] = div(0, offUp(0), pr, pi);
        [dr[0], di[0]] = div(rr[0], ri[0], pr, pi);
      }
      for (let i = 1; i < n; i++) {
        const [pr, pi] = diagAt(i);
        const lo = offLow(i); // imaginary part of the lower off-diagonal
        // m = diag − lower·c[i−1], with lower = i·lo
        const mr = pr - (-lo * ci[i - 1]);
        const mi = pi - lo * cr[i - 1];
        [cr[i], ci[i]] = div(0, i === n - 1 ? 0 : offUp(i), mr, mi);
        // rhs − lower·d[i−1]
        const sr = rr[i] - (-lo * di[i - 1]);
        const si = ri[i] - lo * dr[i - 1];
        [dr[i], di[i]] = div(sr, si, mr, mi);
      }
      const nre = new Array<number>(n);
      const nim = new Array<number>(n);
      nre[n - 1] = dr[n - 1];
      nim[n - 1] = di[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        // out[i] = d[i] − c[i]·out[i+1]
        nre[i] = dr[i] - (cr[i] * nre[i + 1] - ci[i] * nim[i + 1]);
        nim[i] = di[i] - (cr[i] * nim[i + 1] + ci[i] * nre[i + 1]);
      }
      re = nre;
      im = nim;
      if (!insulated) {
        re[0] = re[n - 1] = 0;
        im[0] = im[n - 1] = 0;
      }
    }
    frames.push(density());
    real.push(re.slice());
  }
  return { x, frames, real, potential: V };
}

type Series = { t: number[]; names: string[]; values: number[][] };

/** A system dv/dt = f(t, v…): fourth-order Runge–Kutta. */
function ode(sim: Simulation): Series {
  const vars = sim.variables!;
  const names = vars.map((v) => v.name);
  const rates = vars.map((v) => compileFormula(v.rate, ["t", ...names]));
  const SUB = 50;
  const dt = sim.duration / ((FRAMES - 1) * SUB);
  let state = vars.map((v) => v.start);
  let t = 0;
  const f = (tt: number, s: number[]) => {
    const env: Record<string, number> = { t: tt };
    names.forEach((nm, i) => (env[nm] = s[i]));
    return rates.map((r) => r(env));
  };
  const values: number[][] = [state.slice()];
  const ts = [0];
  for (let k = 1; k < FRAMES; k++) {
    for (let s = 0; s < SUB; s++) {
      const k1 = f(t, state);
      const k2 = f(t + dt / 2, state.map((v, i) => v + (dt / 2) * k1[i]));
      const k3 = f(t + dt / 2, state.map((v, i) => v + (dt / 2) * k2[i]));
      const k4 = f(t + dt, state.map((v, i) => v + dt * k3[i]));
      state = state.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      t += dt;
      if (state.some((v) => !Number.isFinite(v))) {
        throw new Error(`The system blows up before t = ${t.toPrecision(3)}; shorten the duration`);
      }
    }
    values.push(state.slice());
    ts.push(t);
  }
  return { t: ts, names, values };
}

// ── Drawing ────────────────────────────────────────────────────────────────

const W = 480;
const H = 320;
const PX0 = 56;
const PX1 = 464;
const PY0 = 48;
const PY1 = 252;
const BAR_Y = 292;
const FONT = `font-family="system-ui, sans-serif"`;

const fmt = (v: number, digits = 3) => {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toExponential(1).replace("e+", "e");
  return String(Number(v.toPrecision(digits)));
};
// Axis ticks are short: two figures fit the margin, and the axis is there to
// give the scale, not the value.
const tick = (v: number) => fmt(v, 2);
const px = (v: number) => v.toFixed(1);
// Integer x: the samples sit 4 px apart, and a whole coordinate is a third
// shorter over forty frames.
const pxWhole = (v: number) => v.toFixed(0);

function range(values: number[][]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of values) for (const v of row) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("The state is not finite");
  if (hi - lo < 1e-12) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return { lo: lo - pad, hi: hi + pad };
}

function keyTimes(): string {
  return Array.from({ length: FRAMES }, (_, k) => (k / (FRAMES - 1)).toFixed(4)).join(";");
}

/** The frames as one SMIL values list. The loop restarts from t = 0: heat
    does not flow back, so the picture never plays in reverse. */
function loopValues(paths: string[]): string {
  return paths.join(";");
}

function frameText(sim: Simulation, boundaryNote: string | null): string[] {
  const out: string[] = [];
  if (sim.equation) {
    out.push(
      `<text x="${W / 2}" y="26" font-size="16" font-weight="700" fill="${INK}" text-anchor="middle" ${FONT}>${escapeXml(sim.equation)}</text>`,
    );
  }
  // The time bar: a track, a fill that grows over the loop, and the ends.
  out.push(
    `<line x1="${PX0}" y1="${BAR_Y}" x2="${PX1}" y2="${BAR_Y}" stroke="${MUTED}" stroke-width="2" stroke-opacity="0.35"/>`,
    `<rect x="${PX0}" y="${BAR_Y - 2}" width="0" height="4" rx="2" fill="${ACCENT}"><animate attributeName="width" values="0;${PX1 - PX0}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></rect>`,
    `<text x="${PX0}" y="${BAR_Y + 18}" font-size="14" fill="${MUTED}" ${FONT}>t = 0</text>`,
    `<text x="${PX1}" y="${BAR_Y + 18}" font-size="14" fill="${MUTED}" text-anchor="end" ${FONT}>t = ${escapeXml(fmt(sim.duration))}</text>`,
  );
  if (boundaryNote) {
    out.push(
      `<text x="${W / 2}" y="${BAR_Y + 18}" font-size="14" fill="${MUTED}" text-anchor="middle" ${FONT}>${escapeXml(boundaryNote)}</text>`,
    );
  }
  return out;
}

function axes(xLo: string, xHi: string, yLo: string, yHi: string, xLabel: string, uLabel: string): string[] {
  return [
    `<line x1="${PX0}" y1="${PY0}" x2="${PX0}" y2="${PY1}" stroke="${INK}" stroke-width="1.5"/>`,
    `<line x1="${PX0}" y1="${PY1}" x2="${PX1}" y2="${PY1}" stroke="${INK}" stroke-width="1.5"/>`,
    `<text x="${PX0}" y="${PY1 + 18}" font-size="14" fill="${MUTED}" ${FONT}>${escapeXml(xLo)}</text>`,
    `<text x="${PX1}" y="${PY1 + 18}" font-size="14" fill="${MUTED}" text-anchor="end" ${FONT}>${escapeXml(xHi)}</text>`,
    `<text x="${PX0 - 6}" y="${PY1}" font-size="14" fill="${MUTED}" text-anchor="end" ${FONT}>${escapeXml(yLo)}</text>`,
    `<text x="${PX0 - 6}" y="${PY0 + 5}" font-size="14" fill="${MUTED}" text-anchor="end" ${FONT}>${escapeXml(yHi)}</text>`,
    `<text x="${(PX0 + PX1) / 2}" y="${PY1 + 18}" font-size="14" fill="${INK}" text-anchor="middle" ${FONT}>${escapeXml(xLabel)}</text>`,
    `<text x="${PX0 + 6}" y="${PY0 - 8}" font-size="14" fill="${INK}" ${FONT}>${escapeXml(uLabel)}</text>`,
  ];
}

function fieldSvg(sim: Simulation, field: Field, extra: string[] = [], yRange?: { lo: number; hi: number }): string {
  const { x, frames } = field;
  const { lo, hi } = yRange ?? range(frames);
  const sx = (xi: number) => PX0 + ((xi - sim.x0) / (sim.x1 - sim.x0)) * (PX1 - PX0);
  const sy = (v: number) => PY1 - ((v - lo) / (hi - lo)) * (PY1 - PY0);
  const line = (row: number[]) =>
    row.map((v, i) => `${i === 0 ? "M" : "L"}${pxWhole(sx(x[i]))},${px(sy(v))}`).join("");
  const base = lo < 0 && hi > 0 ? sy(0) : PY1;
  const area = (row: number[]) =>
    `${line(row)}L${pxWhole(sx(x[x.length - 1]))},${px(base)}L${pxWhole(sx(x[0]))},${px(base)}Z`;
  const lines = frames.map(line);
  const areas = frames.map(area);
  const anim = (values: string) =>
    `<animate attributeName="d" values="${values}" keyTimes="${keyTimes()}" calcMode="linear" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>`;
  const boundaryNote =
    sim.boundary === "periodic" ? "periodic" : sim.boundary === "insulated" ? "insulated ends" : "ends held";
  const ends =
    sim.boundary === "fixed"
      ? [
          `<circle cx="${px(sx(x[0]))}" cy="${px(sy(frames[0][0]))}" r="4" fill="${INK}"/>`,
          `<circle cx="${px(sx(x[x.length - 1]))}" cy="${px(sy(frames[0][x.length - 1]))}" r="4" fill="${INK}"/>`,
        ]
      : sim.boundary === "insulated"
        ? [
            `<line x1="${PX0}" y1="${PY0}" x2="${PX0}" y2="${PY1}" stroke="${INK}" stroke-width="4"/>`,
            `<line x1="${PX1}" y1="${PY0}" x2="${PX1}" y2="${PY1}" stroke="${INK}" stroke-width="4"/>`,
          ]
        : [];
  const clip = `<clipPath id="plot"><rect x="${PX0}" y="${PY0 - 4}" width="${PX1 - PX0}" height="${PY1 - PY0 + 8}"/></clipPath>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img">`,
    THEME_STYLE,
    `<defs>${clip}</defs>`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${PAPER}"/>`,
    ...axes(tick(sim.x0), tick(sim.x1), tick(lo), tick(hi), sim.xLabel ?? "x", sim.uLabel ?? "u"),
    `<g clip-path="url(#plot)">`,
    // Where it started, kept faint under the motion.
    `<path d="${lines[0]}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="4 4" stroke-opacity="0.7"/>`,
    ...extra,
    `<path d="${areas[0]}" fill="${ACCENT}" fill-opacity="0.16" stroke="none">${anim(loopValues(areas))}</path>`,
    `<path d="${lines[0]}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round">${anim(loopValues(lines))}</path>`,
    `</g>`,
    ...ends,
    ...frameText(sim, boundaryNote),
    `</svg>`,
  ].join("");
}

function seriesSvg(sim: Simulation, series: Series): string {
  const { t, names, values } = series;
  const columns = names.map((_, j) => values.map((row) => row[j]));
  const { lo, hi } = range(columns);
  const sx = (tt: number) => PX0 + (tt / sim.duration) * (PX1 - PX0);
  const sy = (v: number) => PY1 - ((v - lo) / (hi - lo)) * (PY1 - PY0);
  const curves = columns.map(
    (col, j) =>
      `<path d="${col.map((v, i) => `${i === 0 ? "M" : "L"}${px(sx(t[i]))},${px(sy(v))}`).join("")}" fill="none" stroke="${ACCENTS[j % ACCENTS.length]}" stroke-width="2.5" stroke-linejoin="round"/>`,
  );
  // The curves are revealed left to right: a curtain in the paper's color
  // over what has not happened yet, its edge the present moment, sliding
  // across over the loop. A curtain, not a clip: an animated clipPath is not
  // repainted in every renderer, a rect is.
  const curtain =
    `<rect x="${PX0}" y="${PY0 - 4}" width="${PX1 - PX0 + 2}" height="${PY1 - PY0 + 4}" fill="${PAPER}"><animate attributeName="x" values="${PX0};${PX1 + 2}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></rect>` +
    `<line x1="${PX0}" y1="${PY0 - 4}" x2="${PX0}" y2="${PY1}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="3 3"><animate attributeName="x1" values="${PX0};${PX1 + 2}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/><animate attributeName="x2" values="${PX0};${PX1 + 2}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></line>`;
  const legend = names.map(
    (nm, j) =>
      `<rect x="${PX1 - 16 - (names.length - j) * 72}" y="${PY0 - 18}" width="12" height="12" rx="3" fill="${ACCENTS[j % ACCENTS.length]}"/>` +
      `<text x="${PX1 - 16 - (names.length - j) * 72 + 16}" y="${PY0 - 7}" font-size="14" fill="${INK}" ${FONT}>${escapeXml(nm)}</text>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img">`,
    THEME_STYLE,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${PAPER}"/>`,
    ...curves,
    curtain,
    ...axes("0", tick(sim.duration), tick(lo), tick(hi), sim.xLabel ?? "t", sim.uLabel ?? ""),
    ...legend,
    ...frameText(sim, null),
    `</svg>`,
  ].join("");
}

/** The simulation as one SMIL animation, or the reason it could not run —
    a formula that does not parse, a state that is not finite, a duration
    the scheme cannot cover. */
export function renderSimulation(sim: Simulation): { svg: string } | { error: string } {
  try {
    if (sim.law === "ode") {
      if (!sim.variables?.length) return { error: "The system has no variables." };
      return { svg: seriesSvg(sim, ode(sim)) };
    }
    if (!sim.initial) return { error: "The simulation has no initial state." };
    if (!(sim.x1 > sim.x0)) return { error: "The domain is empty: x1 must be past x0." };
    if (sim.law === "heat") return { svg: fieldSvg(sim, heat(sim)) };
    if (sim.law === "wave") return { svg: fieldSvg(sim, wave(sim)) };
    if (sim.law === "advection") return { svg: fieldSvg(sim, advection(sim)) };
    const psi = schrodinger(sim);
    // |ψ|² carries the picture; Re ψ shows the phase running under it, and
    // the potential shows what the packet meets, each drawn to its own range.
    const dens = range(psi.frames);
    const sx = (xi: number) => PX0 + ((xi - sim.x0) / (sim.x1 - sim.x0)) * (PX1 - PX0);
    const reRange = range(psi.real);
    const reScale = (v: number) => PY1 - ((v - reRange.lo) / (reRange.hi - reRange.lo)) * (PY1 - PY0);
    // Every other point: the phase reads at half the density's resolution,
    // and the picture is a third smaller for it.
    const reLines = psi.real.map((row) =>
      row
        .filter((_, i) => i % 2 === 0 || i === row.length - 1)
        .map((v, j) => {
          const i = Math.min(j * 2, row.length - 1);
          return `${j === 0 ? "M" : "L"}${pxWhole(sx(psi.x[i]))},${px(reScale(v))}`;
        })
        .join(""),
    );
    const extra = [
      `<path d="${reLines[0]}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-opacity="0.45"><animate attributeName="d" values="${loopValues(reLines)}" keyTimes="${keyTimes()}" calcMode="linear" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></path>`,
    ];
    const vLo = Math.min(...psi.potential);
    const vHi = Math.max(...psi.potential);
    if (vHi - vLo > 1e-12) {
      const vScale = (v: number) => PY1 - ((v - vLo) / (vHi - vLo)) * (PY1 - PY0) * 0.9;
      extra.unshift(
        `<path d="${psi.potential.map((v, i) => `${i === 0 ? "M" : "L"}${px(sx(psi.x[i]))},${px(vScale(v))}`).join("")}" fill="none" stroke="${MUTED}" stroke-width="2" stroke-dasharray="6 4"/>`,
      );
    }
    return {
      svg: fieldSvg(
        { ...sim, uLabel: sim.uLabel ?? "|ψ|²", boundary: sim.boundary === "periodic" ? "fixed" : sim.boundary },
        psi,
        extra,
        dens,
      ),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The simulation did not run." };
  }
}
