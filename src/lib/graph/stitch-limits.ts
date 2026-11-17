// Stitch's sizes that the box and the route share (SPEC.md §22). Apart from
// lib/graph/stitch.ts, which is server code: the box imports this.

/** The characters of one earlier turn the box sends back with a command.
    A reply can be a full extraction, longer than this: the turn is cut, the
    route refuses nothing, and the model still reads what was asked and the
    start of what was answered. */
export const STITCH_TURN_MAX = 20_000;
