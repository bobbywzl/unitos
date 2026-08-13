import { CheckIcon, SpinnerIcon } from "@/components/icons";

export type IngestStepStatus = "pending" | "active" | "done";
export type IngestStep = { key: string; label: string; status: IngestStepStatus };

// Inline progress pill for document ingest (upload/fetch → parse → save). Lives in the
// document bar where the old static "Parsing…" text used to sit. Driven entirely by
// real backend stage events (see /api/documents), never a simulated timer.
export function IngestProgress({ fileLabel, steps }: { fileLabel: string; steps: IngestStep[] }) {
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const complete = doneCount === steps.length;
  const current = steps[activeIndex] ?? steps[steps.length - 1];
  const position = complete ? steps.length : Math.min(activeIndex === -1 ? steps.length : activeIndex + 1, steps.length);
  const fillPercent = complete
    ? 100
    : (Math.min(doneCount + (activeIndex === -1 ? 0 : 0.5), steps.length) / steps.length) * 100;

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-sand-600">
      {complete ? (
        <CheckIcon size={13} className="shrink-0 text-sage" />
      ) : (
        <SpinnerIcon size={13} className="shrink-0 text-clay motion-safe:animate-spin" />
      )}
      <span className="min-w-0 truncate">
        <span className="font-medium text-sand-700">{complete ? "Done" : `${current.label}…`}</span>{" "}
        <span className="text-sand-500">{fileLabel}</span>
      </span>
      <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-sand-300">
        <span
          className="block h-full rounded-full bg-clay transition-[width] duration-300 ease-out"
          style={{ width: `${fillPercent}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums text-sand-500">
        {position}/{steps.length}
      </span>
    </div>
  );
}

// Ordered 3-step template for one ingest call. receiveLabel differs by source:
// "Uploading" for a PDF file, "Fetching" for a URL.
export function initialIngestSteps(receiveLabel: string): IngestStep[] {
  return [
    { key: "receive", label: receiveLabel, status: "active" },
    { key: "parse", label: "Parsing", status: "pending" },
    { key: "save", label: "Saving", status: "pending" },
  ];
}

// Advances the template when a "parse" or "save" stage event arrives from the server:
// every step before it is done, the named step goes active, everything after stays pending.
export function advanceIngestSteps(steps: IngestStep[], stage: "parse" | "save"): IngestStep[] {
  const idx = steps.findIndex((s) => s.key === stage);
  if (idx === -1) return steps;
  return steps.map((s, i): IngestStep => {
    const status: IngestStepStatus = i < idx ? "done" : i === idx ? "active" : "pending";
    return { ...s, status };
  });
}

export function completeIngestSteps(steps: IngestStep[]): IngestStep[] {
  return steps.map((s) => ({ ...s, status: "done" }));
}
