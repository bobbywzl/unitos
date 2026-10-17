// Blocks a selection may cross, at most: the routes' schemas take no more
// (lib/anchors/passage.ts), and the toolbar says so before a press
// (reader-interactions.tsx). A module of its own, so the reader reads it
// without the server modules passage.ts brings.
export const MAX_SEGMENTS = 40;
