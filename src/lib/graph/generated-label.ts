// A generated document's own command (SPEC.md §22, WALK4-14): a page made by
// a follow-up stores the command before it too ("first → follow-up",
// lib/graph/stitch.ts), so Generated content says what "make that a page"
// made a page of. A label that tells two pages apart takes the last command:
// the one that wrote the page.
export const COMMAND_CHAIN = " → ";

export function ownCommand(command: string): string {
  const at = command.lastIndexOf(COMMAND_CHAIN);
  return (at >= 0 ? command.slice(at + COMMAND_CHAIN.length) : command).trim();
}
