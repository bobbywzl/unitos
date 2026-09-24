// In the reader, a core's words (SPEC.md §28) paint and select like a block
// of their own: the block's id under the "core:" key. Marks, local marks, and
// cards find a core anchor by this key; the key turns back into the block id
// and layer "core" on the way to the server (reader-interactions.tsx
// anchorBody).
const PREFIX = "core:";

export function coreKey(blockId: string): string {
  return `${PREFIX}${blockId}`;
}

export function isCoreKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

/** The block id behind a key: the key itself for a block's text. */
export function blockIdOfKey(key: string): string {
  return isCoreKey(key) ? key.slice(PREFIX.length) : key;
}
