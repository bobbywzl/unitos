// A small control's hit area on a touch screen (SPEC.md §6): the control
// keeps its drawn size, and a transparent 6px band above and below it makes
// a 20px button 32px tall for a finger. Only up and down, so two controls side by side
// never take each other's presses. A mouse gets the drawn size alone.
export const TOUCH_HIT =
  "pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-1.5 pointer-coarse:before:content-['']";
