// The reader's frame while its page renders (SPEC.md §6): the top bar's
// row and the paper under it, so a project opens on its frame at once and
// the content lands in it. The same grid as workspace.tsx.
export default function Loading() {
  return (
    <div
      data-reader-loading
      className="grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[68px_1fr] bg-paper max-md:h-dvh"
    >
      <div className="border-b border-line" />
      <div />
    </div>
  );
}
