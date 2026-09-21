import "./reader.css";

// The Reader frame of the sign-in deck: a selection in the abstract, Simplify, Visualize, and an assistant command, one 18 s loop. Timing comes from the si-r-* keyframes in reader.css, copied from the design file.

const dots = (name: string) => (
  <div className="si-r-think" style={{ animation: `${name} 18s linear infinite` }}>
    <span className="si-r-dot" />
    <span className="si-r-dot" />
    <span className="si-r-dot" />
  </div>
);

const gem = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="#1a1713" stroke="#d6b26a" strokeWidth="2" />
  </svg>
);

const spark = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#c67139">
    <path d="M11 4l1.7 4.3L17 10l-4.3 1.7L11 16l-1.7-4.3L5 10l4.3-1.7L11 4Zm7 9 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13Z" />
  </svg>
);

const cardShadow = "0 14px 34px rgba(46,43,37,0.18), inset 0 0 0 1px #e8dfd0";

export function ReaderFrame() {
  return (
    <div
      className="si-r-frame"
      data-screen-label="Reader"
      style={{ flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start", fontFamily: "var(--font-figtree), system-ui, sans-serif" }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 10",
          overflow: "hidden",
          borderRadius: 14,
          background: "#f7f2e9",
          color: "#201e1d",
          fontSize: 11.5,
          lineHeight: 1.55,
          boxShadow: "inset 0 0 0 1px rgba(32,30,29,0.08)",
        }}
      >
        {/* top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 12px", background: "#ffffff", borderBottom: "1px solid #e8dfd0", fontSize: 10.5 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 9999, background: "#f1ebe0", padding: "3px 9px", fontWeight: 700, color: "#645c50" }}>
            Contents{" "}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <span style={{ borderRadius: 9999, background: "#201e1d", color: "#f5ead8", padding: "3px 10px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Attention Is All You Need</span>
          <span style={{ borderRadius: 9999, padding: "3px 10px", color: "#82796a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Neural Machine Translation…</span>
          <span style={{ marginLeft: "auto", display: "flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 9999, color: "#645c50" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 9999, padding: "3px 10px", fontWeight: 700, color: "#645c50", boxShadow: "inset 0 0 0 1px #e8dfd0" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2m14-11h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2" />
            </svg>
            Extract
          </span>
          <span style={{ borderRadius: 9999, padding: "3px 10px", fontWeight: 700, color: "#645c50", boxShadow: "inset 0 0 0 1px #e8dfd0" }}>Notes</span>
        </div>

        {/* the article */}
        <div style={{ position: "absolute", left: 0, top: 32, bottom: 0, width: "60%", padding: "16px 22px", overflow: "hidden" }}>
          <p style={{ margin: 0, fontFamily: "var(--font-caprasimo), var(--font-figtree), system-ui, sans-serif", fontSize: 18, color: "#2e2b25" }}>Attention Is All You Need</p>
          <p style={{ margin: "6px 0 0", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#82796a" }}>Abstract</p>
          <p style={{ position: "relative", margin: "6px 0 0", color: "#474238" }}>
            The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.{" "}
            <span
              style={{
                borderRadius: 2,
                backgroundImage: "linear-gradient(#f6e3a8, #f6e3a8), linear-gradient(#dcd0ff, #dcd0ff)",
                backgroundRepeat: "no-repeat",
                backgroundSize: "0% 100%, 0% 100%",
                animation: "si-r-sel 18s linear infinite",
              }}
            >
              We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.
            </span>
            {/* highlight colors: a bubble right above the popover */}
            <span style={{ position: "absolute", left: 0, bottom: -36, display: "flex", gap: 6, borderRadius: 9999, background: "#ffffff", padding: "5px 8px", boxShadow: "0 8px 24px rgba(46,43,37,0.18)", animation: "si-r-pop 18s linear infinite" }}>
              <span style={{ width: 12, height: 12, borderRadius: 9999, background: "#c67139" }} />
              <span style={{ width: 12, height: 12, borderRadius: 9999, background: "#7a8a5e" }} />
              <span style={{ width: 12, height: 12, borderRadius: 9999, background: "#d9a83a" }} />
              <span style={{ width: 12, height: 12, borderRadius: 9999, background: "#8a6a9a" }} />
            </span>
            {/* the selection popover: the assistant's command box, then the kind's tools */}
            <span
              style={{
                position: "absolute",
                left: 0,
                right: -6,
                bottom: -104,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                borderRadius: 16,
                background: "#ffffff",
                padding: 8,
                fontSize: 10.5,
                boxShadow: "0 14px 34px rgba(46,43,37,0.2)",
                animation: "si-r-pop 18s linear infinite",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: "#2e2b25" }}>
                  {spark(10)}
                  Assistant
                </span>
                <span style={{ position: "relative", flex: 1, borderRadius: 9999, background: "#f1ebe0", padding: "4px 10px", color: "#2e2b25", overflow: "hidden", whiteSpace: "nowrap", animation: "si-r-box 18s linear infinite" }}>
                  <span style={{ position: "absolute", left: 10, color: "#a29682", animation: "si-r-ph 18s linear infinite" }}>Tell the assistant what to do with this selection…</span>
                  <span style={{ display: "inline-block", overflow: "hidden", whiteSpace: "nowrap", verticalAlign: "bottom", width: 0, animation: "si-r-type 18s linear infinite" }}>What does dropping recurrence and convolutions actually change?</span>
                </span>
                <span style={{ borderRadius: 9999, background: "#c67139", color: "#fff", padding: "4px 10px", fontWeight: 700, animation: "si-r-run 18s linear infinite" }}>Run</span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <span style={{ borderRadius: 9999, padding: "4px 10px", fontWeight: 700, color: "#8c491a", background: "#fbe3d3", animation: "si-r-press 18s linear infinite" }}>Simplify</span>
                <span className="si-r-pill" style={{ display: "inline-flex", alignItems: "center", gap: 4, animation: "si-r-press2 18s linear infinite" }}>
                  {gem(9)}
                  Visualize <span style={{ fontSize: 8.5, color: "#82796a" }}>Ultra</span>
                </span>
                <span className="si-r-pill">Comment</span>
                <span className="si-r-pill">Add to notes</span>
                <span className="si-r-pill">Link across texts</span>
              </span>
            </span>
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU.</p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature.</p>
          <p style={{ margin: "12px 0 0", fontSize: 13, fontWeight: 700, color: "#2e2b25" }}>1 Introduction</p>
          <p style={{ margin: "4px 0 0", color: "#474238" }}>Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation.</p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in the input or output sequences.</p>
        </div>

        {/* the side cards, level with the selection: Simplified, then the Visualization, then the assistant's chat */}
        <div style={{ position: "absolute", left: "61%", right: 12, top: 96, bottom: 44, display: "flex", flexDirection: "column", gap: 8, fontSize: 10.5 }}>
          {/* Simplified */}
          <div style={{ position: "relative", borderRadius: 14, background: "#ffffff", boxShadow: cardShadow, animation: "si-r-card 18s linear infinite" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px 0" }}>
              <span style={{ fontWeight: 700, color: "#2e2b25", animation: "si-r-title-a 18s linear infinite" }}>Simplifying…</span>
              <span style={{ position: "absolute", left: 11, top: 8, fontWeight: 700, color: "#2e2b25", animation: "si-r-title-b 18s linear infinite" }}>Simplified</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, color: "#b5a892" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />
                </svg>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
                <span>✕</span>
              </span>
            </div>
            <div style={{ padding: "5px 11px 9px", color: "#474238" }}>
              {dots("si-r-think")}
              <p style={{ margin: 0, overflow: "hidden", maxHeight: 0, animation: "si-r-s1 18s linear infinite" }}>
                <span style={{ borderRadius: 3, padding: "0 2px", background: "#fbe3d3" }}>We built a new, simpler model and named it the Transformer.</span>
              </p>
              <p style={{ margin: "3px 0 0", overflow: "hidden", maxHeight: 0, animation: "si-r-s2 18s linear infinite" }}>It relates the words of a sentence using attention only — each word looks at all the others. The two older building blocks, recurrence (reading word after word) and convolutions (sliding windows), are dropped completely.</p>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, paddingTop: 7, borderTop: "1px solid #e8dfd0", fontSize: 9.5, overflow: "hidden", maxHeight: 0, animation: "si-r-s3 18s linear infinite" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 9999, padding: "2px 8px", fontWeight: 700, color: "#474238", boxShadow: "inset 0 0 0 1px #e8dfd0" }}>
                  {gem(9)}
                  Continue in a conversation
                </span>
                <span style={{ color: "#b5a892" }}>Press a sentence for its original</span>
              </div>
            </div>
          </div>

          {/* Visualization */}
          <div style={{ position: "relative", borderRadius: 14, background: "#ffffff", boxShadow: cardShadow, animation: "si-r-vcard 18s linear infinite" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px 0" }}>
              {gem(10)}
              <span style={{ fontWeight: 700, color: "#2e2b25", animation: "si-r-vtitle-a 18s linear infinite" }}>Visualizing…</span>
              <span style={{ position: "absolute", left: 27, top: 8, fontWeight: 700, color: "#2e2b25", animation: "si-r-vtitle-b 18s linear infinite" }}>Visualization</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, color: "#b5a892" }}>
                <span style={{ borderRadius: 9999, padding: "1px 7px", fontSize: 9, fontWeight: 700, color: "#474238", boxShadow: "inset 0 0 0 1px #e8dfd0", animation: "si-r-vbody 18s linear infinite" }}>Open</span>
                <span>✕</span>
              </span>
            </div>
            <div style={{ padding: "5px 11px 9px" }}>
              {dots("si-r-vthink")}
              <div style={{ overflow: "hidden", maxHeight: 0, animation: "si-r-vbodyh 18s linear infinite" }}>
                <svg viewBox="0 0 240 84" style={{ display: "block", width: "100%", height: "auto", borderRadius: 8, background: "#fbf8f2" }}>
                  <g fontFamily="var(--font-figtree), system-ui, sans-serif" fontSize="7.5" fill="#474238">
                    <rect x="8" y="8" width="66" height="66" rx="6" fill="#fff" stroke="#d9d0c0" strokeWidth="1" />
                    <text x="41" y="20" textAnchor="middle" fontWeight="700" fill="#82796a">Recurrence</text>
                    <g stroke="#b5a892" strokeWidth="1.2" fill="none" strokeLinecap="round">
                      <circle cx="17" cy="44" r="3.5" />
                      <circle cx="29" cy="44" r="3.5" />
                      <circle cx="41" cy="44" r="3.5" />
                      <circle cx="53" cy="44" r="3.5" />
                      <circle cx="65" cy="44" r="3.5" />
                      <path d="M20.5 44h5M32.5 44h5M44.5 44h5M56.5 44h5" />
                    </g>
                    <text x="41" y="60" textAnchor="middle" fontSize="6.5" fill="#82796a">word after word</text>
                    <g style={{ animation: "si-r-vdraw 18s linear infinite" }}>
                      <path d="M14 14l54 54M68 14L14 68" stroke="#c67139" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.85" />
                    </g>
                    <rect x="87" y="8" width="66" height="66" rx="6" fill="#fff" stroke="#d9d0c0" strokeWidth="1" />
                    <text x="120" y="20" textAnchor="middle" fontWeight="700" fill="#82796a">Convolution</text>
                    <g stroke="#b5a892" strokeWidth="1.2" fill="none" strokeLinecap="round">
                      <circle cx="96" cy="48" r="3.5" />
                      <circle cx="108" cy="48" r="3.5" />
                      <circle cx="120" cy="48" r="3.5" />
                      <circle cx="132" cy="48" r="3.5" />
                      <circle cx="144" cy="48" r="3.5" />
                      <rect x="102" y="40" width="36" height="16" rx="4" strokeDasharray="2 2" />
                      <path d="M108 36l12-8 12 8" />
                    </g>
                    <text x="120" y="64" textAnchor="middle" fontSize="6.5" fill="#82796a">a sliding window</text>
                    <g style={{ animation: "si-r-vdraw 18s linear infinite" }}>
                      <path d="M93 14l54 54M147 14L93 68" stroke="#c67139" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.85" />
                    </g>
                    <rect x="166" y="8" width="66" height="66" rx="6" fill="#fff" stroke="#c67139" strokeWidth="1.4" />
                    <text x="199" y="20" textAnchor="middle" fontWeight="700" fill="#8c491a">Attention only</text>
                    <g stroke="#c67139" strokeWidth="1" strokeLinecap="round" fill="none" style={{ animation: "si-r-vdraw 18s linear infinite" }}>
                      <path d="M175 50 Q187 32 199 50M175 50 Q199 26 223 50M175 50 Q193 38 211 50M187 50 Q199 38 211 50M187 50 Q205 32 223 50M199 50 Q211 38 223 50" strokeOpacity="0.75" />
                    </g>
                    <g stroke="#c67139" strokeWidth="1.2" fill="#fbe3d3">
                      <circle cx="175" cy="50" r="3.5" />
                      <circle cx="187" cy="50" r="3.5" />
                      <circle cx="199" cy="50" r="3.5" />
                      <circle cx="211" cy="50" r="3.5" />
                      <circle cx="223" cy="50" r="3.5" />
                    </g>
                    <text x="199" y="64" textAnchor="middle" fontSize="6.5" fill="#8c491a">every word, every other, at once</text>
                  </g>
                </svg>
                <p style={{ margin: "6px 0 0", fontSize: 9.5, color: "#645c50" }}>“Dispensing with recurrence and convolutions entirely”: the two mechanisms crossed out, the one the Transformer keeps.</p>
              </div>
            </div>
          </div>

          {/* Assistant */}
          <div style={{ position: "relative", borderRadius: 14, background: "#ffffff", boxShadow: cardShadow, animation: "si-r-acard 18s linear infinite" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px 0" }}>
              {spark(10)}
              <span style={{ fontWeight: 700, color: "#2e2b25" }}>Assistant</span>
              <span style={{ fontSize: 9, color: "#b5a892" }}>on the selection · ¶ 1</span>
              <span style={{ marginLeft: "auto", color: "#b5a892" }}>✕</span>
            </div>
            <div style={{ padding: "6px 11px 9px", display: "flex", flexDirection: "column", gap: 4, color: "#474238" }}>
              <p style={{ margin: 0, alignSelf: "flex-end", maxWidth: "88%", borderRadius: 12, background: "#f1ebe0", padding: "3px 9px", color: "#2e2b25" }}>What does dropping recurrence and convolutions actually change?</p>
              {dots("si-r-athink")}
              <p style={{ margin: 0, overflow: "hidden", maxHeight: 0, animation: "si-r-a1 18s linear infinite" }}>
                No recurrence: positions are computed in parallel, so a training step no longer waits on the previous word. <span style={{ color: "#c67139" }}>§3.2, Table 1</span>
              </p>
              <p style={{ margin: 0, overflow: "hidden", maxHeight: 0, animation: "si-r-a2 18s linear infinite" }}>
                No convolutions: two distant words meet in one attention step, not through a stack of layers. <span style={{ color: "#c67139" }}>§4</span>
              </p>
              <p style={{ margin: 0, overflow: "hidden", maxHeight: 0, animation: "si-r-a3 18s linear infinite" }}>
                What replaces them: multi-head self-attention, feed-forward layers, and positional encodings to carry word order. <span style={{ color: "#c67139" }}>§3.1, §3.5</span>
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden", maxHeight: 0, animation: "si-r-a3 18s linear infinite" }}>
                <span style={{ flex: 1, borderRadius: 9999, background: "#f1ebe0", padding: "3px 9px", fontSize: 9.5, color: "#a29682" }}>Reply…</span>
                <span style={{ borderRadius: 9999, background: "#c67139", color: "#fff", padding: "3px 9px", fontSize: 9, fontWeight: 700 }}>Send</span>
              </div>
            </div>
          </div>
        </div>

        {/* bottom row: read aloud, annotation count */}
        <div style={{ position: "absolute", left: "61%", right: 12, bottom: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#82796a" }}>
          <span style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "#ffffff", color: "#645c50", boxShadow: "0 6px 16px rgba(46,43,37,0.14)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
            </svg>
          </span>
          <span>Read the selection aloud</span>
          <span style={{ marginLeft: "auto", borderRadius: 9999, background: "#f1ebe0", padding: "2px 8px", fontWeight: 700, animation: "si-r-count 18s linear infinite" }}>Annotations · 3</span>
        </div>

        {/* the reader-view button, bottom-left */}
        <span style={{ position: "absolute", left: 12, bottom: 12, display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "#f1ebe0", color: "#82796a", boxShadow: "0 1px 3px rgba(46,43,37,0.12)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
          </svg>
        </span>

        {/* the cursor */}
        <svg width="18" height="18" viewBox="0 0 24 24" style={{ position: "absolute", left: 0, top: 0, animation: "si-r-cur 18s cubic-bezier(.5,.1,.3,1) infinite", pointerEvents: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }}>
          <path d="M5.5 3.2v16.2l4.1-3.9 2.5 5.6 2.7-1.2-2.5-5.5 5.6-.6L5.5 3.2Z" fill="#1a1611" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
