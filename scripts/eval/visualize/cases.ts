// The cases of the Visualize loop (SPEC.md §20, §25): one case is one
// selection in one fixture, for one reader, in one language. The set covers
// what Visualize meets: a law of change (simulation), an ordered process
// (animation or diagram), named parts and relations (diagram), quantities
// compared, a mechanism or an arrangement (picture), an abstract idea that
// wants an analogy, and passages a picture should decline — opinion,
// narrative, a claim whose content is its words. `good` says what a good
// answer is, for the judge; `expect` is the decision a careful reader would
// make.
import type { Lang } from "@/lib/i18n/config";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import { ANALYST, LAWYER, ML_ENGINEER, NOVICE } from "../cases";

export type VizKind = "diagram" | "simulation" | "picture" | "animation";

export type VizCase = {
  id: string;
  fixture: string;
  lang: Lang;
  profile: ReaderProfileCtx;
  // The block by its order (1-based) and the text inside it; the whole block
  // when text is absent.
  selection: { block: number; text?: string };
  expect: "draw" | "decline" | "either";
  // The kinds a good picture may take, best first.
  kinds?: VizKind[];
  good: string;
};

export const TEACHER: ReaderProfileCtx = {
  background: "High-school physics teacher.",
  purpose: "Find a picture to show the class.",
  application: "",
};
export const NURSE: ReaderProfileCtx = {
  background: "Registered nurse, ten years on a cardiac ward.",
  purpose: "Refresh the physiology behind what I see on the monitor.",
  application: "",
};
export const DEVELOPER: ReaderProfileCtx = {
  background: "Backend developer, mostly web services; no distributed-systems training.",
  purpose: "Understand the design before reviewing a pull request that uses it.",
  application: "",
};
export const CHEF: ReaderProfileCtx = {
  background: "Professional chef. Left school at sixteen.",
  purpose: "Curious; reads science articles for fun.",
  application: "",
};

export const VIZ_CASES: VizCase[] = [
  // ── paper-sparse-routing: an ML paper ──
  {
    id: "paper-router", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER, selection: { block: 5 },
    expect: "draw", kinds: ["diagram", "picture"],
    good: "The router's pipeline for one query block: pooled query scores every key, the top 4,096 are kept, always with the block's own 512 tokens and the document's first 128, and attention runs over that subset; the retention loss trains the router toward the keys dense attention used. Set against dense attention over every token (the article's baseline).",
  },
  {
    id: "paper-cost", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE, selection: { block: 3 },
    expect: "draw", kinds: ["picture", "diagram"],
    good: "Why fixed patterns fail: dense cost grows with the square of length (18% of a pass at 8k, 84% at 256k); a 4,096-token window is cheap but cannot link a claim on page 3 to evidence on page 190 (72% of windowed failures). The picture shows the long-range link a window cannot reach — the problem the paper's method solves.",
  },
  {
    id: "paper-results", fixture: "paper-sparse-routing", lang: "en", profile: null, selection: { block: 9 },
    expect: "either", kinds: ["picture"],
    good: "LongQA: sparse routing 70.8 vs window 58.9 (11.9 points) vs dense 71.2; the recovered questions have answers >50,000 tokens away; throughput 2.4x; memory 96 GB → 31 GB. A chart-like picture with the exact numbers, or a decline if a picture adds nothing to the table above it.",
  },
  {
    id: "paper-retention-sentence", fixture: "paper-sparse-routing", lang: "en", profile: NOVICE,
    selection: { block: 5, text: "The router is trained jointly with the model on a loss that rewards keeping the keys the dense model attended to most; we call this the retention loss. Without the retention loss, the router keeps recent tokens almost exclusively and accuracy falls by 3.1 points." },
    expect: "either", kinds: ["picture", "diagram"],
    good: "With the retention loss the router keeps the keys dense attention used (spread across the document); without it, it keeps recent tokens almost only and accuracy falls 3.1 points. A before/after picture of which keys are kept, or a decline naming what was tried.",
  },
  {
    id: "paper-limits", fixture: "paper-sparse-routing", lang: "en", profile: ML_ENGINEER, selection: { block: 11 },
    expect: "either", kinds: ["picture", "diagram"],
    good: "The fixed budget of 4,096 keys: evidence spread over more than 4,096 tokens (8% of LongQA, more than ten supporting passages) loses part of it and trails dense by 4.7 points; a mixed query block gets a compromise key set. Picture of a budget overflowing, or a decline.",
  },
  // ── report-earnings-memo: an investment memo ──
  {
    id: "memo-fuel-split", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, selection: { block: 6 },
    expect: "draw", kinds: ["picture", "diagram"],
    good: "The 2.8-point margin gain split into about 1.7 points from fuel (11% of costs × 15% diesel fall) and about 1.1 points from something else — the fleet cut and depot closures (88M, 1.2% of revenue). A stacked bar or bridge with those numbers; the article's question (is the recovery real?) is what the split answers.",
  },
  {
    id: "memo-volume-risk", fixture: "report-earnings-memo", lang: "en", profile: ANALYST, selection: { block: 9 },
    expect: "draw", kinds: ["picture", "diagram"],
    good: "Revenue +6% while shipments −3%: the gap is price (+9% rates); two of the five largest customers moving volume, each worth about 4% of revenue. The picture shows volume and price pulling apart and the exposure.",
  },
  {
    id: "memo-recommendation", fixture: "report-earnings-memo", lang: "en", profile: null, selection: { block: 12 },
    expect: "either", kinds: ["picture", "diagram"],
    good: "Margin now 9.1 = 1.1 structural (holds) + 1.7 fuel (reversing) on top of the 6.3 base; next quarter modelled 7.6%; the price discounts ≥9%; buy below 38 dollars. A picture of margin levels against what the price discounts, or a decline: the recommendation is a judgment.",
  },
  // ── docs-rate-limiting: API docs ──
  {
    id: "docs-bucket", fixture: "docs-rate-limiting", lang: "en", profile: LAWYER, selection: { block: 1 },
    expect: "draw", kinds: ["animation", "picture"],
    good: "A token bucket holding at most 600, refilling at 10 per second, each request taking one token; a request finding it empty gets 429 with Retry-After. The bucket itself is the picture; motion (tokens draining and refilling) helps.",
  },
  {
    id: "docs-retry", fixture: "docs-rate-limiting", lang: "en", profile: DEVELOPER, selection: { block: 5 },
    expect: "draw", kinds: ["diagram", "animation"],
    good: "On 429: read Retry-After and wait at least that long. Retrying without waiting drains the bucket further, and refusals count against a second limit: 1,000 refusals in an hour suspends the key for 15 minutes. The two paths (wait → success; retry at once → more refusals → suspension).",
  },
  {
    id: "docs-bigger-bucket", fixture: "docs-rate-limiting", lang: "en", profile: DEVELOPER, selection: { block: 12, text: "A key's bucket size can be raised to 6,000 requests on request; the refill rate stays at 10 per second, so a larger bucket lets you burst longer, not faster." },
    expect: "draw", kinds: ["picture", "animation"],
    good: "Bucket 600 vs 6,000 with the same 10/s refill: the larger bucket sustains a burst longer, the long-run rate is unchanged. The contrast between burst length and rate is the point.",
  },
  // ── news-rate-decision: news ──
  {
    id: "news-dissent", fixture: "news-rate-decision", lang: "en", profile: null, selection: { block: 5 },
    expect: "either", kinds: ["diagram"],
    good: "The dissent (2 of 9): unemployment 3.9% → 4.4%, openings −22% from peak, so waiting for core inflation to reach 2% means easing too late — set against the majority's hold (core 3.6%, wages 4.8%). A diagram of the two readings, or a decline: it is an argument.",
  },
  {
    id: "news-mortgage", fixture: "news-rate-decision", lang: "en", profile: NOVICE, selection: { block: 7 },
    expect: "either", kinds: ["diagram", "picture"],
    good: "Policy rate hold at 5.25% → mortgage rates: 30-year fixed 6.9% now, expected toward 6.5% by December if the bank cuts. A small chain or two-point picture, or a decline: one conditional fact.",
  },
  {
    id: "news-governor-quote", fixture: "news-rate-decision", lang: "en", profile: null, selection: { block: 3 },
    expect: "either", kinds: ["picture"],
    good: "A quote of the governor's stance: inflation moving the right way (3.4% → 3.1%) but core still at 3.6% against the 2% target; a December cut if the next two readings confirm. A picture of the direction and the gap, or a decline: the quote's content is largely its words.",
  },
  // ── essay-slow-reading: an opinion essay ──
  {
    id: "essay-thesis", fixture: "essay-slow-reading", lang: "en", profile: NOVICE, selection: { block: 1 },
    expect: "decline",
    good: "The essay's opinion (read one thing slowly rather than more things). Opinion: decline, naming what was tried.",
  },
  {
    id: "essay-cost", fixture: "essay-slow-reading", lang: "en", profile: null, selection: { block: 4 },
    expect: "either", kinds: ["picture"],
    good: "The cost of slow reading is everything else not read (eleven hours = three books at the ordinary speed). A trade-off picture with the essay's numbers, or a decline.",
  },
  {
    id: "essay-objection", fixture: "essay-slow-reading", lang: "en", profile: null, selection: { block: 6 },
    expect: "decline",
    good: "An objection and the author's reply: argument whose content is its words. Decline.",
  },
  // ── zh-platform-fees: a Chinese economics article ──
  {
    id: "zh-transfer", fixture: "zh-platform-fees", lang: "zh", profile: null, selection: { block: 7 },
    expect: "draw", kinds: ["diagram", "picture"],
    good: "In Chinese: cutting the fee rate is a transfer from long-tail merchants to head merchants, not from the platform to merchants — head merchants' orders −3% and profit up; long-tail orders −18% and profit down about 13%. The picture shows the transfer's direction against the naive expectation (platform → merchants).",
  },
  {
    id: "zh-chain", fixture: "zh-platform-fees", lang: "zh", profile: NOVICE, selection: { block: 11 },
    expect: "draw", kinds: ["diagram"],
    good: "In Chinese: the chain 抽成率 → 补贴预算 → 订单量 → 长尾商家的生死; a 5-point cut: head merchants earn more, long-tail about 13% less.",
  },
  {
    id: "zh-orders-en", fixture: "zh-platform-fees", lang: "en", profile: ANALYST, selection: { block: 4 },
    expect: "draw", kinds: ["picture", "diagram"],
    good: "In English (reader's language) from a Chinese passage: fee 20% → 15%, subsidies fall, orders −11% in six months; per-order profit +5 points but total profit about −6%. A picture of the two opposing effects netting to a loss.",
  },
  // ── transcript-podcast: an interview ──
  {
    id: "transcript-provenance", fixture: "transcript-podcast", lang: "en", profile: null, selection: { block: 4 },
    expect: "either", kinds: ["diagram"],
    good: "Every claim in an answer points to its source in the document; the source is stored two ways (block and offsets, and the quoted text with context) so it re-finds its place. A diagram of claim → source, or a decline.",
  },
  {
    id: "transcript-opinion", fixture: "transcript-podcast", lang: "en", profile: null, selection: { block: 12, text: "Never let AI output enter the reader's notes without a keystroke from the reader." },
    expect: "decline",
    good: "A rule stated in words: its content is the sentence. Decline.",
  },
  // ── physics-heat-rod: a textbook section with a law of change ──
  {
    id: "heat-ice", fixture: "physics-heat-rod", lang: "en", profile: TEACHER, selection: { block: 6 },
    expect: "draw", kinds: ["simulation"],
    good: "The heat equation integrated on the 1 m copper rod: 20 °C background with the middle 10 cm at 100 °C, both ends held at 0 °C, α ≈ 1.1e-4 m²/s, over roughly 15–60 minutes: the spot spreads and sinks, the ends pull the background down, the profile becomes half a sine wave and shrinks. The ends must read 0 °C while the interior starts at 20 °C.",
  },
  {
    id: "heat-insulated", fixture: "physics-heat-rod", lang: "en", profile: null, selection: { block: 9 },
    expect: "draw", kinds: ["simulation"],
    good: "The same rod with insulated ends: zero slope at the ends, total heat kept, the profile evens out flat at 28 °C in about 15 minutes — set against the ice-water rod of the section before, which drains to 0 °C. A simulation with insulated boundaries; showing the contrast with the fixed-end rod is the point.",
  },
  {
    id: "heat-curvature", fixture: "physics-heat-rod", lang: "en", profile: NOVICE, selection: { block: 3 },
    expect: "draw", kinds: ["picture", "simulation"],
    good: "The heat equation read as curvature: where the temperature profile bends down (a peak) the point cools, where it bends up (a dip) it warms, where it is a straight line nothing changes even if steep. A profile with a peak, a dip, and a straight stretch, each marked with its arrow; or a simulation from such a profile.",
  },
  {
    id: "heat-timescale", fixture: "physics-heat-rod", lang: "en", profile: null, selection: { block: 11 },
    expect: "either", kinds: ["picture"],
    good: "One number sets both decay times: L²/α (1 m copper ≈ 9,100 s ≈ 2.5 h); ice-water decay ≈ π² times shorter, insulated ≈ 4π² shorter; the scale grows with the length squared (10 cm: 91 s; 1 m steel: 23 h). A picture of the scaling, or a decline.",
  },
  {
    id: "heat-history", fixture: "physics-heat-rod", lang: "en", profile: null, selection: { block: 13 },
    expect: "decline",
    good: "Historical narrative (Fourier, the Institut, Lagrange's objection). A timeline would restate dates without an idea. Decline.",
  },
  // ── epi-sir-model: an epidemiology explainer ──
  {
    id: "sir-compartments", fixture: "epi-sir-model", lang: "en", profile: NOVICE, selection: { block: 3 },
    expect: "draw", kinds: ["diagram", "animation"],
    good: "Three compartments S, I, R with one-way flows S → I (infection) → R (recovery or death); a closed population, S + I + R = N.",
  },
  {
    id: "sir-example", fixture: "epi-sir-model", lang: "en", profile: null, selection: { block: 8 },
    expect: "draw", kinds: ["simulation"],
    good: "The ODE integrated: N = 10,000, I0 = 10, β = 0.3, γ = 0.1, over about 100–160 days: I peaks about day 38 near 3,000 when S reaches 3,333 (the two-thirds threshold), and about 9,400 are infected in the end. Curves of S, I, R against days.",
  },
  {
    id: "sir-vaccination", fixture: "epi-sir-model", lang: "en", profile: CHEF, selection: { block: 10 },
    expect: "draw", kinds: ["simulation", "picture"],
    good: "Vaccination moves 5,000 people from S to R before the outbreak: the peak falls from about 3,000 (day 38) to about 320 (day 100); 2,900 infected in all against 9,400. Showing the vaccinated curve against the unvaccinated one of the worked example is the point.",
  },
  {
    id: "sir-threshold", fixture: "epi-sir-model", lang: "en", profile: NOVICE, selection: { block: 6 },
    expect: "draw", kinds: ["picture", "simulation"],
    good: "R0 = β/γ; infections grow while R0 · S/N > 1; they peak when S/N falls to 1/R0; the herd immunity threshold is 1 − 1/R0.",
  },
  {
    id: "sir-limits", fixture: "epi-sir-model", lang: "en", profile: null, selection: { block: 12 },
    expect: "decline",
    good: "A list of the model's assumptions (homogeneous mixing, fixed β, no latent period, permanent immunity, determinism). A list in words; decline.",
  },
  // ── physics-quantum-tunneling: an explainer ──
  {
    id: "qt-reflection", fixture: "physics-quantum-tunneling", lang: "en", profile: TEACHER, selection: { block: 8 },
    expect: "draw", kinds: ["simulation"],
    good: "A Schrödinger simulation: a wave packet meets a rectangular barrier higher than its energy (E = 2 eV, V0 = 3 eV), most of it reflects with interference fringes while overlapping, a smaller packet transmits with the same wavelength; nothing stays inside.",
  },
  {
    id: "qt-width", fixture: "physics-quantum-tunneling", lang: "en", profile: null, selection: { block: 10 },
    expect: "draw", kinds: ["picture"],
    good: "Transmission falls exponentially with width: each extra 0.25 nm divides T by about 13 (24%, 2.1%, 0.16%, 0.013% at 0.25–1.00 nm). A picture where equal steps of width give equal ratios (a log scale or shrinking bars with the exact numbers).",
  },
  {
    id: "qt-stm", fixture: "physics-quantum-tunneling", lang: "en", profile: NOVICE, selection: { block: 13 },
    expect: "draw", kinds: ["picture", "animation"],
    good: "The microscope: a sharp tip about 0.5–1 nm above a surface, the vacuum gap as the barrier, a tunneling current of about 1 nA that falls tenfold per 0.1 nm, a feedback loop raising and lowering the tip to hold the current, the tip's height recorded as the map of atoms.",
  },
  // ── bio-action-potential: a physiology textbook section ──
  {
    id: "ap-sequence", fixture: "bio-action-potential", lang: "en", profile: NURSE, selection: { block: 6 },
    expect: "draw", kinds: ["picture", "animation"],
    good: "The voltage trace of one spike against time: rest −70 mV, threshold −55 mV, Na+ channels open and the positive feedback drives it to +30 mV, Na+ inactivation, K+ out and repolarization, undershoot to −80 mV, back to −70 mV; about 2 ms. Phases labelled with the channel that drives each.",
  },
  {
    id: "ap-saltatory", fixture: "bio-action-potential", lang: "en", profile: NOVICE, selection: { block: 10 },
    expect: "draw", kinds: ["animation", "picture"],
    good: "Saltatory conduction: in a myelinated axon the action potential fires only at the nodes of Ranvier (about 1 mm apart) and jumps between them, up to about 100 m/s, against the unmyelinated axon of the paragraph before, where every patch fires in turn at about 1 m/s.",
  },
  {
    id: "ap-pump", fixture: "bio-action-potential", lang: "en", profile: null, selection: { block: 12 },
    expect: "draw", kinds: ["picture", "animation"],
    good: "The sodium–potassium pump: per ATP, 3 Na+ out and 2 K+ in, both against their gradients; it restores the gradients the spikes run down, runs all the time, and makes the inside a few mV more negative.",
  },
  // ── cs-raft-consensus: a systems article ──
  {
    id: "raft-transitions", fixture: "cs-raft-consensus", lang: "en", profile: DEVELOPER, selection: { block: 7 },
    expect: "draw", kinds: ["diagram"],
    good: "The state machine: follower, candidate, leader, with the five transitions and their triggers — timeout (follower → candidate), majority of votes (candidate → leader), hears a leader of term ≥ own (candidate → follower), timeout with no winner (candidate → candidate, new term), sees a higher term (leader → follower).",
  },
  {
    id: "raft-randomized", fixture: "cs-raft-consensus", lang: "en", profile: DEVELOPER, selection: { block: 11 },
    expect: "draw", kinds: ["animation", "picture"],
    good: "Random election timeouts between 150 and 300 ms: one follower usually times out first, wins a majority and sends a heartbeat before the others time out — the fix for the split-vote problem stated earlier (two candidates at once, votes split, forever). Showing the split vote against the staggered timeouts is the point.",
  },
  {
    id: "raft-replication", fixture: "cs-raft-consensus", lang: "en", profile: null, selection: { block: 9 },
    expect: "draw", kinds: ["animation", "diagram"],
    good: "Log replication: client → leader appends the entry (with its term) → AppendEntries to every follower in parallel (consistency check on the previous index and term) → a majority (leader + 2 of 5) stored it → committed, applied, result to the client → followers apply on the next AppendEntries.",
  },
  {
    id: "raft-paxos", fixture: "cs-raft-consensus", lang: "en", profile: null, selection: { block: 13 },
    expect: "either", kinds: ["diagram", "picture"],
    good: "Raft against Paxos: both need a majority (2f + 1 servers survive f); Paxos agrees on a single value and Multi-Paxos was never fully specified; Raft splits consensus into election, replication, safety with the leader in control; 33 of 43 students did better on Raft. A comparison, or a decline.",
  },
  // ── cs-quicksort: an algorithms textbook ──
  {
    id: "qs-partition", fixture: "cs-quicksort", lang: "en", profile: NOVICE, selection: { block: 5 },
    expect: "draw", kinds: ["animation", "picture"],
    good: "Lomuto partition of [7, 2, 9, 4, 3, 8, 5] around pivot 5, step by step: j scans, i marks the end of the ≤-pivot zone, the swaps (A[0]↔A[1], A[1]↔A[3], A[2]↔A[4]), the last swap puts 5 at position 3: [2, 4, 3, 5, 9, 8, 7]. Every array state must match the list exactly.",
  },
  {
    id: "qs-worst", fixture: "cs-quicksort", lang: "en", profile: null, selection: { block: 11 },
    expect: "draw", kinds: ["picture"],
    good: "Sorted input with the last element as pivot: every partition peels off one element, n levels deep, n(n−1)/2 comparisons (499,500 for n = 1,000, 36 times the average) — against the balanced splits of the average case, about log n levels. A lopsided recursion tree against a balanced one.",
  },
  {
    id: "qs-randomized", fixture: "cs-quicksort", lang: "en", profile: DEVELOPER, selection: { block: 13 },
    expect: "either", kinds: ["picture", "diagram"],
    good: "The fix for the worst case stated earlier: pick the pivot at random, swap it to A[hi], run Lomuto unchanged; expected comparisons about 2n ln n on every input, sorted ones included; median of three as the alternative that an adversary can still defeat.",
  },
  // ── econ-tariff-incidence: an economics article ──
  {
    id: "tariff-wedge", fixture: "econ-tariff-incidence", lang: "en", profile: NOVICE, selection: { block: 5 },
    expect: "draw", kinds: ["picture"],
    good: "Supply and demand with the tariff as a vertical wedge: buyers pay more, sellers receive less, the gap is the tariff; the side that adjusts less (the steeper curve) bears more; buyers' share = Es/(Es + |Ed|).",
  },
  {
    id: "tariff-example", fixture: "econ-tariff-incidence", lang: "en", profile: ANALYST, selection: { block: 7 },
    expect: "draw", kinds: ["picture"],
    good: "The $190 tariff split: buyers pay $950 (bear $150, 79%), foreign sellers receive $760 (bear $40), from $800 before; imports 1,000,000 → 925,000 tons; revenue about $176 million. The exact numbers on a price axis or a split bar.",
  },
  {
    id: "tariff-dwl", fixture: "econ-tariff-incidence", lang: "en", profile: null, selection: { block: 10 },
    expect: "draw", kinds: ["picture"],
    good: "The deadweight-loss triangle between the curves from 925,000 to 1,000,000 tons, ½ × $190 × 75,000 = $7.125 million; buyers lose about $144M, sellers about $38.5M, the government gains $175.75M. The areas on a supply–demand picture.",
  },
  {
    id: "tariff-opinion", fixture: "econ-tariff-incidence", lang: "en", profile: null, selection: { block: 12 },
    expect: "decline",
    good: "A commentator's view that the tariff is good politics: opinion. Decline.",
  },
  // ── eng-four-stroke-engine: an engineering explainer ──
  {
    id: "engine-strokes", fixture: "eng-four-stroke-engine", lang: "en", profile: CHEF, selection: { block: 5 },
    expect: "draw", kinds: ["animation"],
    good: "The four strokes in order with the piston and both valves: intake (intake valve open, piston down, mixture in), compression (both closed, piston up), spark just before the top, power (both closed, piston driven down), exhaust (exhaust valve open, piston up, gas out). Order and valve states must be right.",
  },
  {
    id: "engine-diesel", fixture: "eng-four-stroke-engine", lang: "en", profile: null, selection: { block: 10 },
    expect: "either", kinds: ["diagram", "picture"],
    good: "The Diesel engine against the spark engine described earlier: air only in, compressed 16–20:1 (above 500 °C), fuel injected and ignites on contact, no spark plug, no knock so a higher ratio and over 40% efficiency; cost: weight. A side-by-side of the two, or a decline.",
  },
  {
    id: "engine-flywheel", fixture: "eng-four-stroke-engine", lang: "en", profile: NOVICE, selection: { block: 12 },
    expect: "draw", kinds: ["picture", "animation"],
    good: "Only the power stroke drives the crankshaft: 180 of 720 degrees, a quarter of the cycle; the flywheel stores energy during the power stroke and gives it back through the other three; four cylinders spread power strokes every 180 degrees.",
  },
  // ── finance-bond-prices: a personal-finance article ──
  {
    id: "bond-rates", fixture: "finance-bond-prices", lang: "en", profile: NOVICE, selection: { block: 5 },
    expect: "draw", kinds: ["picture"],
    good: "A 10-year 3% bond ($30 a year on $1,000) when new bonds pay $50: its price falls to about $845 so a buyer earns 5% ($30 coupons plus $155 at maturity); at 1% it would be about $1,189. Price and rate move opposite ways.",
  },
  {
    id: "bond-duration", fixture: "finance-bond-prices", lang: "en", profile: ANALYST, selection: { block: 8 },
    expect: "draw", kinds: ["picture"],
    good: "Duration 8.5: about 8.5% per point; the tangent line predicts about $830 at 5%, the true curve gives about $845 — the gap is convexity. A price-against-rate curve with its tangent at 3%.",
  },
  {
    id: "bond-yield-curve", fixture: "finance-bond-prices", lang: "en", profile: null, selection: { block: 10 },
    expect: "draw", kinds: ["picture"],
    good: "Yield against maturity: the normal upward slope, and the inverted curve (July 2023: 2-year about 4.9%, 10-year about 3.9%). Both shapes on one set of axes, no invented yields beyond the two stated.",
  },
  {
    id: "bond-opinion", fixture: "finance-bond-prices", lang: "en", profile: null, selection: { block: 12 },
    expect: "decline",
    good: "The authors' market view: opinion. Decline.",
  },
  // ── history-bretton-woods: a history article ──
  {
    id: "bw-system", fixture: "history-bretton-woods", lang: "en", profile: NOVICE, selection: { block: 5 },
    expect: "draw", kinds: ["diagram"],
    good: "Two layers: each currency pegged to the dollar within 1%; the dollar convertible to gold at $35 an ounce for foreign central banks; every currency linked to gold through the dollar.",
  },
  {
    id: "bw-triffin", fixture: "history-bretton-woods", lang: "en", profile: null, selection: { block: 8 },
    expect: "draw", kinds: ["diagram", "picture"],
    good: "The dilemma's two horns: the world needs more dollar reserves, which come only from U.S. deficits; each dollar abroad is a claim on a gold stock that does not grow; stop the deficits → reserves run short; continue → confidence in $35 gold convertibility erodes.",
  },
  {
    id: "bw-conference", fixture: "history-bretton-woods", lang: "en", profile: null, selection: { block: 3 },
    expect: "decline",
    good: "Narrative about the conference (place, people, atmosphere). Decline.",
  },
  // ── law-contract-formation: a law-school primer ──
  {
    id: "law-mailbox", fixture: "law-contract-formation", lang: "en", profile: LAWYER, selection: { block: 13 },
    expect: "draw", kinds: ["picture"],
    good: "A timeline 1–7 March: offer posted 1, arrives 3; acceptance posted 4 (contract formed, postal rule); revocation posted 5, received 6 (too late); acceptance arrives 7. Both parties' letters in transit, the formation date marked.",
  },
  {
    id: "law-counteroffer", fixture: "law-contract-formation", lang: "en", profile: NOVICE, selection: { block: 6 },
    expect: "draw", kinds: ["diagram"],
    good: "A counteroffer is a new offer and a rejection that kills the original: Hyde v Wrench — £1,000 offer, £950 counteroffer, declined, later 'acceptance' of £1,000 finds no offer; a request for information leaves the offer open.",
  },
  {
    id: "law-policy", fixture: "law-contract-formation", lang: "en", profile: null, selection: { block: 15 },
    expect: "decline",
    good: "The policy reasons behind the rules: abstract argument in words. Decline.",
  },
  // ── zh-photosynthesis: a Chinese biology textbook ──
  {
    id: "zh-ps-calvin", fixture: "zh-photosynthesis", lang: "zh", profile: NOVICE, selection: { block: 7 },
    expect: "draw", kinds: ["diagram", "animation"],
    good: "In Chinese: the Calvin cycle's three steps in the stroma — CO2 fixation (CO2 + C5 → 2 C3, Rubisco), C3 reduction (ATP, NADPH → 三碳糖), C5 regeneration (ATP); a few 三碳糖 leave as glucose, sucrose, starch; per 3 CO2: 9 ATP, 6 NADPH, net 1 三碳糖. A cycle.",
  },
  {
    id: "zh-ps-link", fixture: "zh-photosynthesis", lang: "zh", profile: null, selection: { block: 9 },
    expect: "draw", kinds: ["diagram"],
    good: "In Chinese: light reactions (类囊体薄膜) send ATP and NADPH to the Calvin cycle (基质); ADP, Pi, NADP+ return; stop the light → C3 up, C5 down; stop the CO2 → C3 down, C5 up.",
  },
  {
    id: "zh-ps-light", fixture: "zh-photosynthesis", lang: "zh", profile: null, selection: { block: 12 },
    expect: "draw", kinds: ["picture"],
    good: "In Chinese: net photosynthesis against light intensity — −2 in the dark, zero at the compensation point (about 30), rising to saturation near 800 at about 20 µmol·m⁻²·s⁻¹; below saturation the light reactions limit, above it CO2, temperature and enzymes.",
  },
  {
    id: "zh-ps-history", fixture: "zh-photosynthesis", lang: "zh", profile: null, selection: { block: 14 },
    expect: "either", kinds: ["diagram", "picture"],
    good: "In Chinese: Calvin's 14C experiment — label, stop the reaction after seconds to minutes, separate by chromatography, read the dark spots; seconds in, the label is almost all in 3-phosphoglycerate, later in sugars; so the carbon's path. A procedure diagram, or a decline: narrative history.",
  },
];
