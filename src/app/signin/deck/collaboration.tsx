import type { CSSProperties } from "react";
import "./collaboration.css";

// Collaboration frame of the sign-in deck: a shared project where Jon's remote cursor highlights a
// sentence, a reply thread types in and resolves, and Jon's edit is accepted. One 11 s CSS loop;
// timing comes from the design file's si-p-* keyframes in collaboration.css.

const badge = (
  size: number,
  fontSize: number,
  bg: string,
  extra: CSSProperties = {},
): CSSProperties => ({
  display: "flex",
  width: size,
  height: size,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9999,
  background: bg,
  color: "#fff",
  fontSize,
  fontWeight: 700,
  ...extra,
});

const ringed = { boxShadow: "0 0 0 2px #fff" } as const;
const card = {
  borderRadius: 12,
  background: "#ffffff",
  boxShadow: "0 10px 28px rgba(46,43,37,0.16), inset 0 0 0 1px #e8dfd0",
} as const;

function ClockIcon({ size, stroke, strokeWidth }: { size: number; stroke: string; strokeWidth: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

const cursorPath = "M5.5 3.2v16.2l4.1-3.9 2.5 5.6 2.7-1.2-2.5-5.5 5.6-.6L5.5 3.2Z";

export function CollaborationFrame() {
  return (
    <div
      className="si-p-frame"
      style={{
        flex: "0 0 100%",
        minWidth: 0,
        scrollSnapAlign: "start",
        fontFamily: "var(--font-figtree), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 10",
          overflow: "hidden",
          borderRadius: 14,
          background: "#f7f2e9",
          color: "#201e1d",
          fontSize: 11,
          lineHeight: 1.55,
          boxShadow: "inset 0 0 0 1px rgba(32,30,29,0.08)",
        }}
      >
        {/* top bar: document tab, presence badges, History, Share */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 32,
            padding: "0 12px",
            background: "#ffffff",
            borderBottom: "1px solid #e8dfd0",
            fontSize: 10.5,
          }}
        >
          <span
            style={{
              borderRadius: 9999,
              background: "#201e1d",
              color: "#f5ead8",
              padding: "3px 10px",
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Attention Is All You Need
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center" }}>
            <span style={badge(20, 8.5, "#c67139", ringed)}>M</span>
            <span className="si-p-join" style={badge(20, 8.5, "#7a8a5e", { marginLeft: -6, ...ringed })}>
              J
            </span>
            <span style={badge(20, 8.5, "#645c50", { marginLeft: -6, ...ringed })}>R</span>
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 9999,
              background: "#f1ebe0",
              padding: "3px 9px",
              fontWeight: 700,
              color: "#645c50",
            }}
          >
            <ClockIcon size={9} stroke="currentColor" strokeWidth={2.75} />
            History
          </span>
          <span style={{ borderRadius: 9999, background: "#c67139", color: "#fff", padding: "3px 10px", fontWeight: 700 }}>
            Share
          </span>
        </div>

        {/* the article */}
        <div style={{ position: "absolute", left: 0, top: 32, bottom: 0, width: "55%", padding: "14px 18px", overflow: "hidden" }}>
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#82796a" }}>
            3 Model architecture
          </p>
          <p style={{ margin: "6px 0 0", color: "#474238" }}>
            Most competitive neural sequence transduction models have an encoder-decoder structure.{" "}
            <span
              className="si-p-hl"
              style={{
                borderRadius: 2,
                backgroundImage: "linear-gradient(#e3e8d6, #e3e8d6)",
                backgroundRepeat: "no-repeat",
                backgroundSize: "0% 100%",
              }}
            >
              Here, the encoder maps an input sequence of symbol representations to a sequence of continuous representations.
            </span>
          </p>
          <p style={{ position: "relative", margin: "8px 0 0", color: "#474238" }}>
            Given z, the decoder then generates an output sequence of symbols one element at a time.{" "}
            <span className="si-p-editmark" style={{ borderRadius: 2 }}>
              At each step the model is auto-regressive, consuming the previously generated symbols as additional input.
            </span>
            <span
              className="si-p-editbadge"
              style={{
                position: "absolute",
                right: -6,
                top: -4,
                display: "inline-flex",
                width: 14,
                height: 14,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 9999,
                background: "#7a8a5e",
                color: "#fff",
                fontSize: 8,
              }}
            >
              J
            </span>
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder, shown in the left and right halves of Figure 1, respectively.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 12, fontWeight: 700, color: "#2e2b25" }}>3.1 Encoder and decoder stacks</p>
          <p style={{ margin: "4px 0 0", color: "#474238" }}>
            The encoder is composed of a stack of N = 6 identical layers. Each layer has two sub-layers: a multi-head self-attention mechanism and a position-wise fully connected feed-forward network.
          </p>
        </div>

        {/* Jon's remote cursor and name tag */}
        <div
          className="si-p-remote"
          style={{
            position: "absolute",
            left: "4%",
            top: "30%",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "flex-start",
            pointerEvents: "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d={cursorPath} fill="#7a8a5e" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              margin: "-2px 0 0 10px",
              borderRadius: 9999,
              background: "#7a8a5e",
              color: "#fff",
              padding: "1px 6px",
              fontSize: 8.5,
              fontWeight: 700,
            }}
          >
            Jon
          </span>
        </div>

        {/* the share row */}
        <div
          style={{
            position: "absolute",
            left: "4%",
            bottom: 118,
            width: "47%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 12,
            background: "#ffffff",
            padding: "7px 10px",
            fontSize: 10,
            boxShadow: "0 6px 18px rgba(46,43,37,0.12), inset 0 0 0 1px #e8dfd0",
          }}
        >
          <span style={{ display: "inline-flex" }}>
            <span style={badge(16, 7, "#c67139", ringed)}>M</span>
            <span style={badge(16, 7, "#7a8a5e", { marginLeft: -5, ...ringed })}>J</span>
            <span style={badge(16, 7, "#645c50", { marginLeft: -5, ...ringed })}>R</span>
          </span>
          <span style={{ color: "#474238" }}>
            <b>Mira</b> owner · <b>Jon</b> editor · <b>Rui</b> viewer
          </span>
          <span
            style={{
              marginLeft: "auto",
              borderRadius: 9999,
              padding: "1px 7px",
              fontWeight: 700,
              color: "#645c50",
              boxShadow: "inset 0 0 0 1px #e8dfd0",
            }}
          >
            Manage
          </span>
        </div>

        {/* the edits panel: Jon's edit awaits Accept */}
        <div
          className="si-p-edit"
          style={{ position: "absolute", left: "4%", bottom: 12, width: "47%", padding: "8px 10px", fontSize: 10.5, ...card }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#82796a" }}>
              Edits · 1 pending
            </span>
            <span style={badge(14, 7, "#7a8a5e", { marginLeft: "auto" })}>J</span>
            <span style={{ fontSize: 9, color: "#b5a892" }}>Jon · 13:06 · ¶ 2</span>
          </div>
          <p style={{ margin: "5px 0 0", color: "#474238" }}>
            <span style={{ textDecoration: "line-through", color: "#b5a892" }}>consuming the previously generated symbols</span>{" "}
            <span style={{ background: "#e3e8d6", borderRadius: 2 }}>conditioning on every symbol generated so far</span>
          </p>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <span className="si-p-editaccept" style={{ borderRadius: 9999, padding: "2px 9px", fontWeight: 700 }}>
              Accept
            </span>
            <span style={{ borderRadius: 9999, padding: "2px 9px", fontWeight: 700, color: "#82796a", boxShadow: "inset 0 0 0 1px #e8dfd0" }}>
              Reject
            </span>
            <span style={{ marginLeft: "auto", fontWeight: 700, color: "#645c50" }}>Reply</span>
          </div>
        </div>

        {/* the note and its thread */}
        <div style={{ position: "absolute", right: 12, top: 44, width: "41%", padding: "10px 11px", fontSize: 10.5, ...card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={badge(16, 8, "#c67139")}>M</span>
            <span style={{ fontWeight: 700, color: "#474238" }}>Mira</span>
            <span style={{ fontSize: 9, color: "#b5a892" }}>Sep 20, 13:02</span>
            <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 9, color: "#b5a892" }}>#e91b</span>
          </div>
          <p style={{ margin: "5px 0 0", fontWeight: 700, color: "#2e2b25" }}>Encoder = continuous representations</p>
          <p style={{ margin: "2px 0 0", color: "#474238" }}>
            The encoder&apos;s job is only the mapping to z; generation is the decoder&apos;s. Worth a diagram for the group.
          </p>
          <p style={{ margin: "5px 0 0", paddingLeft: 6, borderLeft: "2px solid #c67139", fontSize: 9.5, color: "#82796a" }}>
            “maps an input sequence of symbol representations” ¶ 1
          </p>
          <div style={{ marginTop: 7, borderTop: "1px solid #e8dfd0", paddingTop: 7, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="si-p-r1" style={{ display: "flex", gap: 6, alignItems: "flex-start", overflow: "hidden", maxHeight: 0 }}>
              <span style={badge(14, 7, "#7a8a5e", { flexShrink: 0 })}>J</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 5, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, color: "#474238" }}>Jon</span>
                  <span style={{ fontSize: 8.5, color: "#b5a892" }}>Sep 20, 13:04</span>
                  <span className="si-p-resolvebtn" style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 700, color: "#82796a" }}>
                    Resolve
                  </span>
                  <span style={{ fontSize: 9, color: "#b5a892" }}>×</span>
                </div>
                <p className="si-p-t1" style={{ margin: "1px 0 0", color: "#474238", overflow: "hidden", whiteSpace: "nowrap", width: 0 }}>
                  Highlighted the sentence — anchor the diagram on it.
                </p>
              </div>
            </div>
            <div className="si-p-r2" style={{ display: "flex", gap: 6, alignItems: "flex-start", overflow: "hidden", maxHeight: 0 }}>
              <span style={badge(14, 7, "#c67139", { flexShrink: 0 })}>M</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 5, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, color: "#474238" }}>Mira</span>
                  <span style={{ fontSize: 8.5, color: "#b5a892" }}>Sep 20, 13:05</span>
                  <span style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 700, color: "#82796a" }}>Resolve</span>
                  <span style={{ fontSize: 9, color: "#b5a892" }}>×</span>
                </div>
                <p className="si-p-t2" style={{ margin: "1px 0 0", color: "#474238", overflow: "hidden", whiteSpace: "nowrap", width: 0 }}>
                  Agreed. Your edit to ¶ 2 reads better — accepting.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="si-p-count" style={{ fontSize: 9, fontWeight: 700, color: "#82796a" }}>
                1 resolved
              </span>
              <span className="si-p-compose" style={{ display: "flex", flex: 1, gap: 4, alignItems: "center" }}>
                <span style={{ flex: 1, borderRadius: 9999, background: "#f1ebe0", padding: "3px 9px", color: "#a29682", fontSize: 9.5 }}>
                  Reply…
                </span>
                <span style={{ borderRadius: 9999, background: "#c67139", color: "#fff", padding: "3px 9px", fontSize: 9, fontWeight: 700 }}>
                  Reply
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* a second annotation's thread, below */}
        <div style={{ position: "absolute", right: 12, bottom: 72, width: "41%", padding: "8px 11px", fontSize: 10.5, ...card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: "#7a8a5e" }} />
            <span style={{ fontWeight: 700, color: "#2e2b25" }}>Highlight</span>
            <span style={{ fontSize: 9, color: "#b5a892" }}>Jon · ¶ 1</span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#b5a892" }}>···</span>
          </div>
          <p style={{ margin: "3px 0 0", color: "#474238", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            “the encoder maps an input sequence of symbol representations…”
          </p>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6, paddingTop: 6, borderTop: "1px solid #e8dfd0" }}>
            <span style={badge(14, 7, "#645c50", { flexShrink: 0 })}>R</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 5, alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, color: "#474238" }}>Rui</span>
                <span style={{ fontSize: 8.5, color: "#b5a892" }}>Sep 19, 21:48</span>
                <span style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 700, color: "#82796a" }}>Resolve</span>
              </div>
              <p style={{ margin: "1px 0 0", color: "#474238" }}>Link this to the BERT encoder paragraph? Same mapping.</p>
            </div>
          </div>
        </div>

        {/* the History strip */}
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: "41%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 12,
            background: "#ffffff",
            padding: "7px 10px",
            fontSize: 10,
            boxShadow: "0 6px 18px rgba(46,43,37,0.12), inset 0 0 0 1px #e8dfd0",
          }}
        >
          <ClockIcon size={11} stroke="#82796a" strokeWidth={2.5} />
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", color: "#474238" }}>
            <b>History</b> · Jon edited ¶ 2 · Mira added #e91b · Rui highlighted ¶ 1
          </span>
          <span style={{ color: "#b5a892" }}>3 today</span>
        </div>

        {/* the reader's own cursor */}
        <svg
          className="si-p-cur"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }}
        >
          <path d={cursorPath} fill="#1a1611" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
