"use client";

import { Component, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";

// The assistant panel's error boundary: an error the panel throws while it
// draws stays in the panel. The panel shows the error's words and a button
// that draws the panel again, fresh; the reader, the page, and every other
// tool keep working. The composer's draft is kept (CLAUDE.md rule zero 6):
// the panel reads it again when it is drawn again.

type State = { error: Error | null; round: number };

class Boundary extends Component<{ children: ReactNode; fallback: (error: Error, reset: () => void) => ReactNode }, State> {
  state: State = { error: null, round: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[assistant] the panel stopped on an error:", error);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState((s) => ({ error: null, round: s.round + 1 })));
    }
    // A new round draws the panel anew: its state starts fresh.
    return <div key={this.state.round} className="contents">{this.props.children}</div>;
  }
}

export function AssistantBoundary({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <Boundary
      fallback={(error, reset) => (
        <div role="alert" className="m-4 flex flex-col gap-2 rounded-2xl bg-card p-4 text-[13px] text-sand-700 shadow-soft">
          <p className="font-semibold text-sand-800">{t("assistant.crashed")}</p>
          <p className="break-words text-[12px] text-red-600">{error.message || String(error)}</p>
          <button
            onClick={reset}
            data-track="assistant-restart"
            className="self-start rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-paper"
          >
            {t("assistant.crashedRestart")}
          </button>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}
