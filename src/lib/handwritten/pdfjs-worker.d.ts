// pdfjs-dist ships no types for its worker module. Page renders import it for
// its WorkerMessageHandler alone (lib/handwritten/pages.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
