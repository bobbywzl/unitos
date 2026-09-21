import type { CSSProperties } from "react";
import "./notes-full-page.css";

// Notes full page frame: three notes side by side, a press on Stacked, then a hold-drag merge of #c71e into #a3f2.
// Timing comes from the design file's si-c-* keyframes (12 s loop) in notes-full-page.css.

const figtree = "var(--font-figtree), system-ui, sans-serif";
const caprasimo = "var(--font-caprasimo), var(--font-figtree), system-ui, sans-serif";

const pane: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: "14px",
  background: "#ffffff",
  boxShadow: "0 6px 18px rgba(46,43,37,0.1)",
  overflow: "hidden",
};
const paneHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 10px",
  borderBottom: "1px solid #e8dfd0",
  fontSize: "8.5px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#82796a",
};
const paneIdRow: CSSProperties = { display: "flex", alignItems: "center", gap: "6px" };
const mono: CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: "9px", color: "#b5a892" };
const dim: CSSProperties = { marginLeft: "auto", color: "#b5a892" };
const paneTitle: CSSProperties = { margin: "5px 0 0", fontWeight: 700, color: "#2e2b25" };
const paneBody: CSSProperties = { margin: "3px 0 0", color: "#474238" };
const paneQuote: CSSProperties = { margin: "8px 0 0", paddingLeft: "7px", borderLeft: "2px solid #c67139", color: "#645c50" };
const paneMeta: CSSProperties = { margin: "8px 0 0", fontSize: "9px", color: "#b5a892" };

const row: CSSProperties = {
  borderRadius: "14px",
  background: "#ffffff",
  padding: "9px 12px",
  boxShadow: "0 6px 18px rgba(46,43,37,0.1)",
};
const rowHead: CSSProperties = { display: "flex", gap: "6px", alignItems: "center" };
const rowLabel: CSSProperties = {
  fontSize: "8.5px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#82796a",
};
const rowTitle: CSSProperties = { margin: "4px 0 0", fontWeight: 700, color: "#2e2b25" };
const rowBody: CSSProperties = { margin: "2px 0 0", color: "#474238" };
const rowQuote: CSSProperties = { margin: "6px 0 0", paddingLeft: "7px", borderLeft: "2px solid #c67139", color: "#645c50" };
const ref: CSSProperties = { color: "#b5a892" };

export function NotesFullPageFrame() {
  return (
    <div
      className="si-c-frame"
      data-screen-label="Notes full page"
      style={{ flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", fontFamily: figtree }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 10",
          overflow: "hidden",
          borderRadius: "14px",
          background: "#f7f2e9",
          color: "#201e1d",
          fontSize: "11px",
          lineHeight: 1.5,
          boxShadow: "inset 0 0 0 1px rgba(32,30,29,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            height: "36px",
            padding: "0 14px",
            borderBottom: "1px solid #e8dfd0",
            fontSize: "10.5px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              borderRadius: "9999px",
              padding: "3px 8px",
              fontWeight: 700,
              color: "#82796a",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Notes
          </span>
          <span style={{ fontFamily: caprasimo, fontSize: "13px" }}>Comparing 3 notes</span>
          <span
            style={{
              marginLeft: "auto",
              position: "relative",
              display: "inline-flex",
              borderRadius: "9999px",
              background: "#e8dfd0",
              padding: "2px",
            }}
          >
            <span
              className="si-c-seg"
              style={{
                position: "absolute",
                left: "2px",
                top: "2px",
                bottom: "2px",
                width: "calc(50% - 2px)",
                borderRadius: "9999px",
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
              }}
            />
            <span style={{ position: "relative", padding: "3px 10px", fontWeight: 700, color: "#645c50" }}>Side by side</span>
            <span style={{ position: "relative", padding: "3px 10px", fontWeight: 700, color: "#645c50" }}>Stacked</span>
          </span>
          <span
            style={{
              borderRadius: "9999px",
              padding: "4px 10px",
              color: "#645c50",
              boxShadow: "inset 0 0 0 1px #e8dfd0",
              background: "#fff",
            }}
          >
            Add note… ▾
          </span>
        </div>

        {/* side by side: three panes, each its own scroller with the whole card */}
        <div
          className="si-c-cols"
          style={{
            position: "absolute",
            left: "14px",
            right: "14px",
            top: "48px",
            bottom: "14px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "10px",
          }}
        >
          <div style={pane}>
            <div style={paneHead}>
              Introduction<span style={dim}>✕</span>
            </div>
            <div style={{ padding: "10px" }}>
              <div style={paneIdRow}>
                <span style={mono}>#a3f2</span>
                <span style={dim}>···</span>
              </div>
              <p style={paneTitle}>Attention replaces recurrence</p>
              <p style={paneBody}>
                Every position attends to every other in one step — no sequential chain, so training parallelizes across the sentence.
              </p>
              <p style={paneQuote}>
                “dispensing with recurrence and convolutions entirely” <span style={ref}>¶ 1</span>
              </p>
              <p style={paneMeta}>2 sources · edited today</p>
            </div>
          </div>
          <div style={pane}>
            <div style={paneHead}>
              Training<span style={dim}>✕</span>
            </div>
            <div style={{ padding: "10px" }}>
              <div style={paneIdRow}>
                <span style={mono}>#c71e</span>
                <span style={dim}>···</span>
              </div>
              <p style={paneTitle}>Why it trains faster</p>
              <p style={paneBody}>
                Parallel attention means the whole batch runs at once: 12 hours on eight P100s to a new BLEU record.
              </p>
              <p style={paneQuote}>
                “trained for 12 hours on eight P100 GPUs” <span style={ref}>¶ 4</span>
              </p>
              <p style={paneMeta}>1 source · Mira, yesterday</p>
            </div>
          </div>
          <div style={pane}>
            <div style={paneHead}>
              Results<span style={dim}>✕</span>
            </div>
            <div style={{ padding: "10px" }}>
              <div style={paneIdRow}>
                <span style={mono}>#9d40</span>
                <span style={dim}>···</span>
              </div>
              <p style={paneTitle}>28.4 BLEU, and 41.8</p>
              <p style={paneBody}>Two records with one architecture. The En–Fr number came from 3.5 days of training.</p>
              <p style={paneQuote}>
                “a new single-model state-of-the-art BLEU score of 41.8” <span style={ref}>¶ 3</span>
              </p>
              <p style={paneMeta}>1 source · edited today</p>
            </div>
          </div>
        </div>

        {/* stacked */}
        <div
          className="si-c-rows"
          style={{
            position: "absolute",
            left: "14px",
            right: "14px",
            top: "48px",
            bottom: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div className="si-c-bloom" style={{ ...row, position: "relative" }}>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: "absolute",
                inset: "-3px",
                width: "calc(100% + 6px)",
                height: "calc(100% + 6px)",
                pointerEvents: "none",
                overflow: "visible",
              }}
            >
              <rect
                className="si-c-ring"
                x="1"
                y="1"
                width="98"
                height="98"
                rx="6"
                ry="14"
                fill="none"
                stroke="#c67139"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset="100"
                opacity="0"
              />
            </svg>
            <div style={rowHead}>
              <span style={rowLabel}>Introduction</span>
              <span style={mono}>#a3f2</span>
              <span style={dim}>✕</span>
            </div>
            <p style={rowTitle}>Attention replaces recurrence</p>
            <p style={rowBody}>
              Every position attends to every other in one step — no sequential chain, so training parallelizes across the sentence.
            </p>
            <div className="si-c-join" style={{ overflow: "hidden", maxHeight: 0, opacity: 0 }}>
              <p
                style={{
                  margin: "8px 0 0",
                  paddingTop: "6px",
                  borderTop: "1px solid #e8dfd0",
                  fontSize: "9px",
                  fontWeight: 700,
                  color: "#b5a892",
                }}
              >
                Why it trains faster
              </p>
              <p style={rowBody}>
                Parallel attention means the whole batch runs at once: 12 hours on eight P100s to a new BLEU record.
              </p>
            </div>
            <p style={rowQuote}>
              “dispensing with recurrence and convolutions entirely” <span style={ref}>¶ 1</span>
              <span
                className="si-c-join2"
                style={{
                  overflow: "hidden",
                  display: "inline-block",
                  maxWidth: 0,
                  whiteSpace: "nowrap",
                  verticalAlign: "bottom",
                }}
              >
                {" "}
                · “trained for 12 hours on eight P100 GPUs” <span style={ref}>¶ 4</span>
              </span>
            </p>
          </div>
          <div className="si-c-held" style={{ ...row, position: "relative", zIndex: 2 }}>
            <div style={rowHead}>
              <span style={rowLabel}>Training</span>
              <span style={mono}>#c71e</span>
              <span style={dim}>✕</span>
            </div>
            <p style={rowTitle}>Why it trains faster</p>
            <p style={rowBody}>
              Parallel attention means the whole batch runs at once: 12 hours on eight P100s to a new BLEU record.
            </p>
            <p style={rowQuote}>
              “trained for 12 hours on eight P100 GPUs” <span style={ref}>¶ 4</span>
            </p>
          </div>
          <div className="si-c-up" style={row}>
            <div style={rowHead}>
              <span style={rowLabel}>Results</span>
              <span style={mono}>#9d40</span>
              <span style={dim}>✕</span>
            </div>
            <p style={rowTitle}>28.4 BLEU, and 41.8</p>
            <p style={rowBody}>Two records with one architecture. The En–Fr number came from 3.5 days of training.</p>
            <p style={rowQuote}>
              “a new single-model state-of-the-art BLEU score of 41.8” <span style={ref}>¶ 3</span>
            </p>
          </div>
          <div className="si-c-up" style={row}>
            <div style={rowHead}>
              <span style={rowLabel}>Related work</span>
              <span style={mono}>#4b8c</span>
              <span style={dim}>✕</span>
            </div>
            <p style={rowTitle}>Where the idea came from</p>
            <p style={rowBody}>
              Self-attention was already in reading comprehension and entailment models; the Transformer is the first to rely on it alone.
            </p>
            <p style={rowQuote}>
              “the first transduction model relying entirely on self-attention” <span style={ref}>¶ 9</span>
            </p>
          </div>
          <div className="si-c-up" style={row}>
            <div style={rowHead}>
              <span style={rowLabel}>Open questions</span>
              <span style={mono}>#e10d</span>
              <span style={dim}>✕</span>
            </div>
            <p style={rowTitle}>Does the quadratic cost bite?</p>
            <p style={rowBody}>
              Attention is O(n²) in sequence length — fine at 512 tokens, ask Stitch what Scaling Laws says past that.
            </p>
          </div>
        </div>

        <div
          className="si-c-undo"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "14px",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            borderRadius: "9999px",
            background: "#ffffff",
            padding: "5px 6px 5px 12px",
            fontSize: "10.5px",
            boxShadow: "0 10px 24px rgba(46,43,37,0.2), inset 0 0 0 1px #e8dfd0",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#645c50" }}>Merged #c71e into #a3f2</span>
          <span style={{ borderRadius: "9999px", background: "#f1ebe0", padding: "3px 10px", fontWeight: 700, color: "#2e2b25" }}>
            Undo
          </span>
        </div>
        <svg
          className="si-c-cur"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
          }}
        >
          <path
            d="M5.5 3.2v16.2l4.1-3.9 2.5 5.6 2.7-1.2-2.5-5.5 5.6-.6L5.5 3.2Z"
            fill="#1a1611"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
