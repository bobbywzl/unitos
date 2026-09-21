import type { CSSProperties } from "react";
import "./graph.css";

// Graph and Stitch frame of the sign-in deck: the graph canvas, the pair's link list, the Stitch box, Recommended links, and Generated content in one 12 s loop. Timing comes from the design file's si-g-* keyframes in graph.css.

const FIGTREE = "var(--font-figtree), system-ui, sans-serif";
const CAPRASIMO =
  "var(--font-caprasimo), var(--font-figtree), system-ui, sans-serif";

const nodeStyle: CSSProperties = {
  position: "absolute",
  transform: "translate(-50%, -50%)",
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  borderRadius: "9999px",
  background: "#ffffff",
  padding: "5px 10px",
  fontWeight: 700,
  color: "#2e2b25",
  whiteSpace: "nowrap",
  boxShadow: "0 6px 16px rgba(46,43,37,0.14)",
};

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "8.5px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#82796a",
};

const rowTextStyle: CSSProperties = {
  minWidth: 0,
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#474238",
};

const acceptStyle: CSSProperties = {
  borderRadius: "9999px",
  padding: "1px 7px",
  fontWeight: 700,
  color: "#7a8a5e",
  boxShadow: "inset 0 0 0 1px #7a8a5e",
};

const chipStyle: CSSProperties = {
  borderRadius: "9999px",
  background: "#fbe3d3",
  color: "#8c491a",
  padding: "1px 7px",
};

const suggStyle: CSSProperties = {
  borderRadius: "9999px",
  background: "#f1ebe0",
  padding: "3px 9px",
  color: "#474238",
};

function DocIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#c67139"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3v5h5M7 3h7l5 5v13H7z" />
    </svg>
  );
}

export function GraphFrame() {
  return (
    <div
      className="si-g-frame"
      data-screen-label="Graph and Stitch"
      style={{
        flex: "0 0 100%",
        minWidth: 0,
        scrollSnapAlign: "start",
        fontFamily: FIGTREE,
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
          fontSize: "10.5px",
          lineHeight: 1.5,
          boxShadow: "inset 0 0 0 1px rgba(32,30,29,0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.5,
            backgroundImage:
              "radial-gradient(rgba(32,30,29,0.1) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "12px",
            top: "10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ fontFamily: CAPRASIMO, fontSize: "13px" }}>Graph</span>
          <span style={{ color: "#82796a" }}>6 documents · 11 links</span>
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <defs>
            <linearGradient id="si-g-mid" x1="0" x2="1">
              <stop offset="0" stopColor="#c67139" stopOpacity="0.35" />
              <stop offset="0.5" stopColor="#8c491a" stopOpacity="1" />
              <stop offset="1" stopColor="#c67139" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <path
            d="M18 30 C 32 22, 44 22, 58 26"
            fill="none"
            stroke="#c67139"
            strokeWidth="2.4"
            strokeOpacity="0.7"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M18 30 C 20 44, 26 52, 36 58"
            fill="none"
            stroke="#c67139"
            strokeWidth="1"
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M58 26 C 62 38, 64 46, 68 56"
            fill="none"
            stroke="#c67139"
            strokeWidth="1.4"
            strokeOpacity="0.5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M36 58 C 48 56, 56 56, 68 56"
            fill="none"
            stroke="url(#si-g-mid)"
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M58 26 C 66 30, 74 36, 82 44"
            fill="none"
            stroke="#c67139"
            strokeWidth="1"
            strokeOpacity="0.4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M68 56 C 74 52, 78 48, 82 44"
            fill="none"
            stroke="#c67139"
            strokeWidth="1.8"
            strokeOpacity="0.6"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d="M18 30 C 36 42, 52 48, 68 56"
            fill="none"
            stroke="#c67139"
            strokeWidth="1.6"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{
              animation:
                "si-g-dash1 12s linear infinite, si-g-flow 1.2s linear infinite",
            }}
          />
          <path
            d="M58 26 C 50 36, 44 46, 36 58"
            fill="none"
            stroke="#c67139"
            strokeWidth="1.6"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{
              animation:
                "si-g-dash2 12s linear infinite, si-g-flow 1.2s linear infinite",
            }}
          />
          <path
            d="M36 58 C 30 66, 24 70, 18 72"
            fill="none"
            stroke="#c67139"
            strokeWidth="1.6"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{
              animation:
                "si-g-dash3 12s linear infinite, si-g-flow 1.2s linear infinite",
            }}
          />
          <path
            d="M18 30 C 36 42, 52 48, 68 56"
            fill="none"
            stroke="#c67139"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{ animation: "si-g-solid1 12s linear infinite" }}
          />
        </svg>
        <div
          style={{
            ...nodeStyle,
            left: "18%",
            top: "30%",
            animation: "si-g-pick1 12s linear infinite",
          }}
        >
          <DocIcon />
          Attention Is All You Need
        </div>
        <div
          style={{
            ...nodeStyle,
            left: "58%",
            top: "26%",
            animation: "si-g-pick2 12s linear infinite",
          }}
        >
          <DocIcon />
          BERT
        </div>
        <div
          style={{
            ...nodeStyle,
            left: "36%",
            top: "58%",
            animation: "si-g-pick3 12s linear infinite",
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c67139"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h12v12H4zM16 10l5-3v10l-5-3" />
          </svg>
          Lecture 12 · transcript
        </div>
        <div style={{ ...nodeStyle, left: "68%", top: "56%" }}>
          <DocIcon />
          Scaling Laws
        </div>
        <div style={{ ...nodeStyle, left: "82%", top: "44%" }}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c67139"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12a9 9 0 0 1 18 0" />
          </svg>
          Course notes · web
        </div>
        <div style={{ ...nodeStyle, left: "18%", top: "72%" }}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c67139"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18V6l12 6-12 6Z" />
          </svg>
          Seminar audio
        </div>
        {/* the pair's link list, on hovering the thick curve */}
        <div
          style={{
            position: "absolute",
            left: "52%",
            top: "36%",
            transform: "translateX(-50%)",
            width: "32%",
            borderRadius: "12px",
            background: "#ffffff",
            padding: "7px 9px",
            boxShadow:
              "0 10px 24px rgba(46,43,37,0.18), inset 0 0 0 1px #e8dfd0",
            animation: "si-g-pair 12s linear infinite",
          }}
        >
          <p style={cardTitleStyle}>Lecture 12 ↔ Scaling Laws · 5 links</p>
          <p
            style={{
              margin: "4px 0 0",
              color: "#474238",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            14:02 “compute grows with the square” ↔ ¶ 12
          </p>
          <p
            style={{
              margin: "2px 0 0",
              color: "#474238",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            31:40 “the loss curve bends” ↔ Fig. 1
          </p>
          <p style={{ margin: "2px 0 0", color: "#b5a892" }}>+ 3 more</p>
        </div>
        {/* Recommended links and Generated content, beside the canvas */}
        <div
          style={{
            position: "absolute",
            right: "10px",
            top: "10px",
            width: "28%",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "9.5px",
          }}
        >
          <div
            style={{
              borderRadius: "12px",
              background: "#ffffff",
              padding: "8px 10px",
              boxShadow:
                "0 10px 24px rgba(46,43,37,0.16), inset 0 0 0 1px #e8dfd0",
              animation: "si-g-rec 12s linear infinite",
            }}
          >
            <p style={cardTitleStyle}>Recommended links · 3</p>
            <div
              style={{
                marginTop: "6px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                animation: "si-g-row1 12s linear infinite",
              }}
            >
              <span style={rowTextStyle}>
                Attention ¶ 3 ↔ Scaling Laws ¶ 12
              </span>
              <span
                style={{
                  borderRadius: "9999px",
                  padding: "1px 7px",
                  fontWeight: 700,
                  animation: "si-g-accept 12s linear infinite",
                }}
              >
                Accept
              </span>
            </div>
            <div
              style={{
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                animation: "si-g-row2 12s linear infinite",
              }}
            >
              <span style={rowTextStyle}>BERT ¶ 2 ↔ Lecture 12 · 14:02</span>
              <span style={acceptStyle}>Accept</span>
            </div>
            <div
              style={{
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                animation: "si-g-row3 12s linear infinite",
              }}
            >
              <span style={rowTextStyle}>
                Lecture 12 · 31:40 ↔ Seminar audio 08:15
              </span>
              <span style={acceptStyle}>Accept</span>
            </div>
          </div>
          <div
            style={{
              borderRadius: "12px",
              background: "#ffffff",
              padding: "8px 10px",
              boxShadow:
                "0 10px 24px rgba(46,43,37,0.16), inset 0 0 0 1px #e8dfd0",
              animation: "si-g-gen 12s linear infinite",
            }}
          >
            <p style={cardTitleStyle}>Generated content · 1</p>
            <div
              style={{
                marginTop: "6px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: "block",
                    fontWeight: 700,
                    color: "#2e2b25",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  Attention cost across sequence length
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: "9px",
                    color: "#b5a892",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  From the command: Connect the passages…
                </span>
              </span>
              <span
                style={{
                  borderRadius: "9999px",
                  background: "#c67139",
                  color: "#fff",
                  padding: "1px 8px",
                  fontWeight: 700,
                }}
              >
                Open
              </span>
            </div>
          </div>
        </div>
        {/* the Stitch box at the foot of the canvas */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "10px",
            transform: "translateX(-50%)",
            width: "82%",
            borderRadius: "16px",
            background: "rgba(255,255,255,0.96)",
            boxShadow:
              "0 14px 34px rgba(46,43,37,0.2), inset 0 0 0 1px #e8dfd0",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 10px 0",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#c67139">
              <path d="M11 4l1.7 4.3L17 10l-4.3 1.7L11 16l-1.7-4.3L5 10l4.3-1.7L11 4Zm7 9 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13Z" />
            </svg>
            <span style={{ fontFamily: CAPRASIMO, fontSize: "12px" }}>
              Stitch
            </span>
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "9.5px",
                color: "#b5a892",
              }}
            >
              The assistant reads every document whole; a video or audio
              document as its transcript. It draws links between passages, or
              writes a new page from them, or both.
            </span>
            <span style={{ color: "#b5a892" }}>✕</span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "4px",
              padding: "5px 10px 0",
              fontSize: "9.5px",
              color: "#645c50",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                animation: "si-g-scope-all 12s linear infinite",
              }}
            >
              Every document (6)
            </span>
            <span
              style={{
                position: "absolute",
                fontWeight: 700,
                animation: "si-g-scope 12s linear infinite",
              }}
            >
              3 documents picked
            </span>
            <span
              style={{
                ...chipStyle,
                animation: "si-g-chip1 12s linear infinite",
              }}
            >
              Attention Is All You Need ✕
            </span>
            <span
              style={{
                ...chipStyle,
                animation: "si-g-chip2 12s linear infinite",
              }}
            >
              BERT ✕
            </span>
            <span
              style={{
                ...chipStyle,
                animation: "si-g-chip3 12s linear infinite",
              }}
            >
              Lecture 12 ✕
            </span>
            <span
              style={{
                borderRadius: "9999px",
                padding: "1px 7px",
                animation: "si-g-pickbtn 12s linear infinite",
              }}
            >
              Pick documents
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px",
              padding: "6px 10px 0",
              animation: "si-g-sugg 12s linear infinite",
            }}
          >
            <span style={suggStyle}>Gather every paragraph that mentions…</span>
            <span
              style={{
                ...suggStyle,
                animation: "si-g-suggpress 12s linear infinite",
              }}
            >
              Connect the passages that answer…
            </span>
            <span style={suggStyle}>
              Find where these documents contradict each other
            </span>
          </div>
          <div
            style={{
              padding: "6px 10px 0",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <p
              style={{
                margin: 0,
                alignSelf: "flex-end",
                maxWidth: "85%",
                borderRadius: "12px",
                background: "#f1ebe0",
                padding: "4px 10px",
                color: "#2e2b25",
                overflow: "hidden",
                maxHeight: 0,
                animation: "si-g-user 12s linear infinite",
              }}
            >
              Connect the passages that answer how attention cost grows with
              sequence length
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                color: "#645c50",
                overflow: "hidden",
                maxHeight: 0,
                animation: "si-g-think 12s linear infinite",
              }}
            >
              <span
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "9999px",
                  border: "2px solid #e8dfd0",
                  borderTopColor: "#c67139",
                  animation: "si-g-spin 0.8s linear infinite",
                }}
              />
              Reading the documents…
              <span
                style={{
                  marginLeft: "auto",
                  borderRadius: "9999px",
                  padding: "1px 8px",
                  fontSize: "9px",
                  boxShadow: "inset 0 0 0 1px #e8dfd0",
                }}
              >
                ■ Stop
              </span>
            </div>
            <div
              style={{
                color: "#474238",
                overflow: "hidden",
                maxHeight: 0,
                animation: "si-g-reply 12s linear infinite",
              }}
            >
              <p style={{ margin: 0 }}>
                All three answer it: the paper gives the quadratic term, BERT
                measures it at 512 tokens, the lecture explains why.
              </p>
              <p style={{ margin: "2px 0 0", color: "#645c50" }}>
                3 links proposed. Accept them under Recommended links.
              </p>
              <p style={{ margin: "2px 0 0", color: "#645c50" }}>
                Page written: Attention cost across sequence length{" "}
                <span
                  style={{
                    borderRadius: "9999px",
                    background: "#c67139",
                    color: "#fff",
                    padding: "0 7px",
                    fontSize: "9px",
                    fontWeight: 700,
                  }}
                >
                  Open
                </span>
              </p>
              <p
                style={{ margin: "2px 0 0", fontSize: "9px", color: "#82796a" }}
              >
                Read 3 of 3 documents · Attention Is All You Need 42 blocks read
                · BERT 61 blocks read · Lecture 12 312 transcript lines read
              </p>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 8px 8px",
            }}
          >
            <span
              style={{
                flex: 1,
                borderRadius: "12px",
                background: "#f1ebe0",
                padding: "6px 10px",
                color: "#2e2b25",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  verticalAlign: "bottom",
                  width: 0,
                  animation: "si-g-type 12s linear infinite",
                }}
              >
                Connect the passages that answer how attention cost grows with
                sequence length
              </span>
              <span
                style={{
                  color: "#a29682",
                  animation: "si-g-ph 12s linear infinite",
                }}
              >
                What should the assistant do across these documents?
              </span>
            </span>
            <span
              style={{
                borderRadius: "9999px",
                background: "#c67139",
                color: "#fff",
                padding: "6px 12px",
                fontWeight: 700,
              }}
            >
              Send
            </span>
          </div>
        </div>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            animation: "si-g-cur 12s cubic-bezier(.4,0,.2,1) infinite",
          }}
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
