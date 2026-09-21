import "./notes-in-reader.css";

// Notes in the reader: a highlight card dropped on a note, then a note held out of the tray and edited over the article.
// Timing comes from the si-n-* keyframes in notes-in-reader.css (12 s loop).

const heading = {
  display: "flex",
  alignItems: "baseline",
  gap: "6px",
  fontSize: "8.5px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#82796a",
} as const;

const card = {
  borderRadius: "12px",
  background: "#ffffff",
  padding: "8px 10px",
  fontSize: "10.5px",
  boxShadow: "0 4px 14px rgba(46,43,37,0.1)",
} as const;

const gist = {
  margin: "2px 0 0",
  color: "#82796a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

const roundButton = {
  display: "flex",
  width: "22px",
  height: "22px",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "9999px",
  background: "#ffffff",
  color: "#645c50",
  boxShadow: "0 1px 3px rgba(46,43,37,0.1)",
} as const;

export function NotesInReaderFrame() {
  return (
    <div
      className="si-n-frame"
      data-screen-label="Notes in the reader"
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
          borderRadius: "14px",
          background: "#f7f2e9",
          color: "#201e1d",
          fontSize: "11px",
          lineHeight: 1.55,
          boxShadow: "inset 0 0 0 1px rgba(32,30,29,0.08)",
          containerType: "size",
        }}
      >
        {/* the article */}
        <div
          className="si-n-article"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "58%",
            padding: "16px 20px",
            overflow: "hidden",
            background: "#fbf8f2",
          }}
        >
          <span
            className="si-n-wrap"
            style={{
              float: "right",
              width: 0,
              height: 0,
              marginLeft: "14px",
              shapeOutside: "inset(0)",
            }}
          />
          <p
            style={{
              margin: 0,
              fontFamily:
                "var(--font-caprasimo), var(--font-figtree), system-ui, sans-serif",
              fontSize: "15px",
              color: "#2e2b25",
            }}
          >
            Attention Is All You Need
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            The dominant sequence transduction models are based on complex
            recurrent or convolutional neural networks.{" "}
            <span style={{ background: "#f6e3a8", borderRadius: "2px" }}>
              We propose a new simple network architecture, the Transformer,
              based solely on attention mechanisms, dispensing with recurrence
              and convolutions entirely.
            </span>
            <span
              style={{
                display: "inline-flex",
                width: "12px",
                height: "12px",
                marginLeft: "3px",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "9999px",
                background: "#d9a83a",
                color: "#fff",
                fontSize: "7px",
                verticalAlign: "middle",
              }}
            >
              1
            </span>
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            Experiments on two machine translation tasks show these models to be
            superior in quality while being more parallelizable and requiring
            significantly less time to train.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            Our model achieves 28.4 BLEU on the WMT 2014 English-to-German
            translation task, improving over the existing best results,
            including ensembles, by over 2 BLEU.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            Recurrent models factor computation along the symbol positions of
            the input and output sequences, generating a sequence of hidden
            states h<sub>t</sub> as a function of the previous hidden state and
            the input for position t.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            This inherently sequential nature precludes parallelization within
            training examples, which becomes critical at longer sequence
            lengths, as memory constraints limit batching across examples.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            Attention mechanisms have become an integral part of compelling
            sequence modeling and transduction models in various tasks, allowing
            modeling of dependencies without regard to their distance in the
            input or output sequences. In all but a few cases, however, such
            attention mechanisms are used in conjunction with a recurrent
            network.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            In this work we propose the Transformer, a model architecture
            eschewing recurrence and instead relying entirely on an attention
            mechanism to draw global dependencies between input and output. The
            Transformer allows for significantly more parallelization and can
            reach a new state of the art in translation quality after being
            trained for as little as twelve hours on eight P100 GPUs.
          </p>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: "12px",
              fontWeight: 700,
              color: "#2e2b25",
            }}
          >
            2 Background
          </p>
          <p style={{ margin: "4px 0 0", color: "#474238" }}>
            The goal of reducing sequential computation also forms the
            foundation of the Extended Neural GPU, ByteNet and ConvS2S, all of
            which use convolutional neural networks as basic building block,
            computing hidden representations in parallel for all input and
            output positions.
          </p>
          <p style={{ margin: "8px 0 0", color: "#474238" }}>
            In these models, the number of operations required to relate signals
            from two arbitrary input or output positions grows in the distance
            between positions, linearly for ConvS2S and logarithmically for
            ByteNet. This makes it more difficult to learn dependencies between
            distant positions.
          </p>
        </div>

        {/* the highlight's card over the article, with its grip */}
        <div
          className="si-n-ann"
          style={{
            position: "absolute",
            left: "6%",
            top: "39%",
            width: "42%",
            borderRadius: "12px",
            background: "#ffffff",
            padding: "8px 10px",
            fontSize: "10.5px",
            boxShadow:
              "0 10px 28px rgba(46,43,37,0.2), inset 0 0 0 1px #e8dfd0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#b5a892", letterSpacing: "-1px" }}>⋮⋮</span>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "9999px",
                background: "#d9a83a",
              }}
            />
            <span style={{ fontWeight: 700, color: "#2e2b25" }}>Highlight</span>
            <span style={{ marginLeft: "auto", color: "#b5a892" }}>
              ¶ 1 · ···
            </span>
          </div>
          <p style={{ margin: "4px 0 0", color: "#474238" }}>
            “…based solely on attention mechanisms, dispensing with recurrence
            and convolutions entirely.”
          </p>
          <p style={{ margin: "3px 0 0", color: "#645c50" }}>
            Core claim — everything else follows from it.
          </p>
        </div>

        {/* the tray */}
        <div
          className="si-n-tray"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "42%",
            padding: "12px",
            borderLeft: "1px solid #e8dfd0",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span
              style={{
                flex: 1,
                borderRadius: "9999px",
                background: "#ffffff",
                padding: "5px 10px",
                fontSize: "10.5px",
                color: "#b5a892",
                boxShadow: "0 1px 3px rgba(46,43,37,0.1)",
              }}
            >
              Search notes
            </span>
            <span style={roundButton}>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </span>
            <span style={roundButton}>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </span>
          </div>
          <div style={{ ...heading, color: "#8c491a" }}>
            Pending · 1
            <span
              style={{
                marginLeft: "auto",
                fontWeight: 500,
                letterSpacing: 0,
                textTransform: "none",
                color: "#b5a892",
              }}
            >
              ← → to decide
            </span>
          </div>
          <div
            style={{
              ...card,
              boxShadow:
                "0 4px 14px rgba(46,43,37,0.1), inset 0 0 0 1px #f3d9c6",
            }}
          >
            <p style={{ margin: 0, color: "#474238" }}>
              The BLEU gain of 2 over ensembles is the headline result.
            </p>
            <p
              style={{
                margin: "3px 0 0",
                paddingLeft: "6px",
                borderLeft: "2px solid #c67139",
                fontSize: "9.5px",
                color: "#82796a",
              }}
            >
              “improving over the existing best results, including ensembles, by
              over 2 BLEU” ¶ 2
            </p>
            <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
              <span
                style={{
                  borderRadius: "9999px",
                  background: "#7a8a5e",
                  color: "#fff",
                  padding: "2px 9px",
                  fontWeight: 700,
                }}
              >
                Accept
              </span>
              <span
                style={{
                  borderRadius: "9999px",
                  padding: "2px 9px",
                  fontWeight: 700,
                  color: "#82796a",
                  boxShadow: "inset 0 0 0 1px #e8dfd0",
                }}
              >
                Reject
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "9px",
                  color: "#b5a892",
                }}
              >
                Enter · Backspace
              </span>
            </div>
          </div>
          <div style={heading}>
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            Abstract{" "}
            <span style={{ fontWeight: 500, color: "#b5a892" }}>3</span>
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                gap: "4px",
                letterSpacing: 0,
                textTransform: "none",
                fontWeight: 700,
                color: "#645c50",
              }}
            >
              <span
                style={{
                  borderRadius: "9999px",
                  background: "#fff",
                  padding: "2px 8px",
                  boxShadow: "0 1px 3px rgba(46,43,37,0.1)",
                }}
              >
                + Add note
              </span>
              <span
                style={{
                  borderRadius: "9999px",
                  background: "#fff",
                  padding: "2px 6px",
                  boxShadow: "0 1px 3px rgba(46,43,37,0.1)",
                }}
              >
                🎙
              </span>
            </span>
          </div>
          <div className="si-n-lift" style={card}>
            <p style={{ margin: 0, fontWeight: 700, color: "#2e2b25" }}>
              Attention replaces recurrence
            </p>
            <p style={gist}>
              Every position attends to every other in one step…
            </p>
          </div>
          <div
            className="si-n-target"
            style={{ position: "relative", ...card }}
          >
            <p style={{ margin: 0, fontWeight: 700, color: "#2e2b25" }}>
              Why it trains faster
            </p>
            <p style={gist}>Parallel attention runs the whole batch at once…</p>
            <div
              className="si-n-grow"
              style={{ overflow: "hidden", maxHeight: 0, opacity: 0 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  marginTop: "6px",
                  borderRadius: "8px",
                  background: "#fbf8f2",
                  padding: "4px 7px",
                  fontSize: "9.5px",
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "9999px",
                    background: "#d9a83a",
                  }}
                />
                <span style={{ fontWeight: 700, color: "#474238" }}>
                  Highlight
                </span>
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    color: "#82796a",
                  }}
                >
                  “…dispensing with recurrence…”
                </span>
                <span style={{ color: "#c67139" }}>↗</span>
              </div>
            </div>
          </div>
          <div style={card}>
            <p style={{ margin: 0, fontWeight: 700, color: "#2e2b25" }}>
              28.4 BLEU, and 41.8
            </p>
            <p style={gist}>Two records with one architecture…</p>
          </div>
          <div style={heading}>
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            Introduction{" "}
            <span style={{ fontWeight: 500, color: "#b5a892" }}>1</span>
          </div>
        </div>

        {/* the toast */}
        <div
          className="si-n-toast"
          style={{
            position: "absolute",
            right: "12px",
            bottom: "12px",
            borderRadius: "9999px",
            background: "#7a8a5e",
            color: "#fff",
            padding: "4px 10px",
            fontSize: "10.5px",
            fontWeight: 700,
          }}
        >
          Added to #c71e
        </div>

        {/* the floating card: the note over the article, draggable, then editing */}
        <div
          className="si-n-float"
          style={{
            position: "absolute",
            left: "60%",
            top: "52%",
            width: "38%",
            borderRadius: "14px",
            background: "#ffffff",
            fontSize: "10.5px",
            boxShadow:
              "0 18px 40px rgba(46,43,37,0.28), inset 0 0 0 1px #e8dfd0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 10px 0",
            }}
          >
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "9px",
                color: "#b5a892",
              }}
            >
              #a3f2
            </span>
            <span
              style={{
                fontSize: "8.5px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#82796a",
              }}
            >
              Abstract
            </span>
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                gap: "6px",
                color: "#82796a",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  borderRadius: "9999px",
                  padding: "1px 6px",
                  fontSize: "9px",
                  background: "#fbe3d3",
                  color: "#8c491a",
                  fontWeight: 700,
                }}
              >
                Wrap text
              </span>
              <span
                className="si-n-pencil"
                style={{
                  display: "inline-flex",
                  width: "18px",
                  height: "18px",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "9999px",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m14 4 6 6-9 9H5v-6l9-9Z" />
                </svg>
              </span>
              <span>✕</span>
            </span>
          </div>
          <div className="si-n-read" style={{ padding: "6px 10px 10px" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#2e2b25" }}>
              Attention replaces recurrence
            </p>
            <p style={{ margin: "2px 0 0", color: "#474238" }}>
              Every position attends to every other in one step — no sequential
              chain, so training parallelizes across the sentence.
            </p>
            <p
              style={{
                margin: "6px 0 0",
                paddingLeft: "7px",
                borderLeft: "2px solid #c67139",
                color: "#645c50",
              }}
            >
              “dispensing with recurrence and convolutions entirely”{" "}
              <span style={{ color: "#b5a892" }}>¶ 1</span>
            </p>
          </div>
          <div
            className="si-n-edit"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "30px",
              padding: "0 10px 10px",
              opacity: 0,
            }}
          >
            <div
              style={{
                borderRadius: "8px",
                background: "#fbf8f2",
                padding: "4px 7px",
                fontWeight: 700,
                color: "#2e2b25",
                boxShadow: "inset 0 0 0 1px #e8dfd0",
              }}
            >
              Attention replaces recurrence
            </div>
            <div
              style={{
                marginTop: "4px",
                borderRadius: "8px",
                background: "#fbf8f2",
                padding: "5px 7px",
                minHeight: "52px",
                color: "#474238",
                boxShadow: "inset 0 0 0 1px #c67139",
              }}
            >
              Every position attends to every other in one step — no sequential
              chain, so training parallelizes across the sentence.
              <span
                className="si-n-type"
                style={{
                  display: "inline-block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  verticalAlign: "bottom",
                  width: 0,
                }}
              >
                {" "}
                Contrast ¶ 4: the RNN builds one hidden state per step, so
                nothing runs in parallel.
              </span>
              <span
                className="si-n-caret"
                style={{
                  display: "inline-block",
                  width: "1px",
                  height: "11px",
                  background: "#c67139",
                  verticalAlign: "-2px",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
              <span
                style={{
                  borderRadius: "9999px",
                  background: "#c67139",
                  color: "#fff",
                  padding: "3px 10px",
                  fontWeight: 700,
                }}
              >
                Done
              </span>
              <span
                style={{
                  borderRadius: "9999px",
                  padding: "3px 10px",
                  fontWeight: 700,
                  color: "#82796a",
                  boxShadow: "inset 0 0 0 1px #e8dfd0",
                }}
              >
                Cancel
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "9px",
                  color: "#b5a892",
                  alignSelf: "center",
                }}
              >
                Saved
              </span>
            </div>
          </div>
          <span
            style={{
              position: "absolute",
              right: "4px",
              bottom: "4px",
              width: "8px",
              height: "8px",
              borderRight: "2px solid #d9d0c0",
              borderBottom: "2px solid #d9d0c0",
            }}
          />
        </div>

        {/* the pointer */}
        <div
          aria-hidden
          className="si-n-cur"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <svg
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
    </div>
  );
}
