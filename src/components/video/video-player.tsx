"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SpinnerIcon,
  VolumeIcon,
} from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { markdownPreview } from "@/components/markdown";
import {
  formatTime,
  formatTimeRange,
  regionBounds,
  regionPathD,
  type Region,
  type VideoAnnotationItem,
} from "@/lib/video/types";

// The player (SPEC.md §11): custom controls, an SVG overlay for annotations,
// and a scrubber with one marker per annotation. Two engines behind one
// surface — a plain <video> for uploads, the YouTube IFrame player for
// YouTube videos — so the overlay, drawing, markers, and Visual behave alike.
// The video itself is never modified; the overlay is the note layer on top.
// Regions are percent coordinates of the frame; the overlay is sized to the
// frame's content box, so they stay glued at any player size and in fullscreen.

export type VideoSource =
  | { kind: "upload"; src: string }
  | { kind: "youtube"; youtubeId: string };

export type VideoPlayerHandle = {
  seek: (t: number, opts?: { play?: boolean }) => void;
  pause: () => void;
  time: () => number;
  /** The current frame as a JPEG data URL, cropped toward the region when one
      is given. Null when the frame is not ready, and always null for a YouTube
      video: its iframe cannot be drawn. The pane pulls those frames from the
      storyboard sheets instead (SPEC.md §11). */
  capture: (region?: Region | null) => string | null;
  /** The frame at a given time, seeking there first and waiting for it to
      render. Capturing straight after a seek otherwise catches the frame the
      player has not replaced yet. */
  captureAt: (time: number, region?: Region | null) => Promise<string | null>;
};

// What both engines expose to the controls.
type Engine = {
  play(): void;
  pause(): void;
  seek(t: number): void;
  time(): number;
  duration(): number;
  setMuted(muted: boolean): void;
};

// ── The YouTube IFrame API, loaded once ─────────────────────────────────────

type YTPlayerInstance = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  mute(): void;
  unMute(): void;
  destroy(): void;
};
type YTEvent = { target: YTPlayerInstance; data?: number };
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady?: (e: YTEvent) => void;
        onStateChange?: (e: YTEvent) => void;
        onError?: (e: YTEvent) => void;
      };
    },
  ) => YTPlayerInstance;
};

let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as unknown as {
    YT?: YTNamespace & { Player?: unknown };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (w.YT?.Player) return Promise.resolve(w.YT as YTNamespace);
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const previous = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(w.YT as YTNamespace);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    });
  }
  return ytApiPromise;
}

// Fixed warm-dark stage colors: the player frame stays dark in both themes.
const STAGE = "#12100e";
const STAGE_TEXT = "#f5ead8";
const STAGE_MUTED = "rgba(245, 234, 216, 0.55)";

const CONTROL_BUTTON =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--player-text)] hover:bg-white/10";

// The freehand loop being drawn: pointer positions in percent coordinates.
type DrawState = { points: { x: number; y: number }[] } | null;

// The audio stage decoration: a fixed pseudo-waveform. Deterministic heights,
// tinted up to the playback position.
const AUDIO_BARS = Array.from({ length: 64 }, (_, i) =>
  Math.round(24 + 58 * Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.53) * 0.4)),
);

// An ellipse as a path, so the dashed pending outline renders one way.
function ellipsePathD(r: { cx: number; cy: number; rx: number; ry: number }): string {
  return `M ${r.cx - r.rx} ${r.cy} a ${r.rx} ${r.ry} 0 1 0 ${2 * r.rx} 0 a ${r.rx} ${r.ry} 0 1 0 ${-2 * r.rx} 0`;
}

// The frame currently showing in a <video>, as a JPEG data URL, cropped
// toward a region with a little context around it.
function drawFrame(video: HTMLVideoElement | null, region?: Region | null): string | null {
  if (!video || video.videoWidth === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (region) {
      const b = regionBounds(region);
      const pad = 2.5; // percent of frame around the loop
      const x1 = Math.max(0, ((b.x1 - pad) / 100) * video.videoWidth);
      const y1 = Math.max(0, ((b.y1 - pad) / 100) * video.videoHeight);
      const x2 = Math.min(video.videoWidth, ((b.x2 + pad) / 100) * video.videoWidth);
      const y2 = Math.min(video.videoHeight, ((b.y2 + pad) / 100) * video.videoHeight);
      if (x2 - x1 > 16 && y2 - y1 > 16) {
        sx = x1;
        sy = y1;
        sw = x2 - x1;
        sh = y2 - y1;
      }
    }
    const scale = Math.min(1, 1024 / Math.max(sw, sh));
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null; // tainted canvas or decode failure
  }
}

export const VideoPlayer = forwardRef<
  VideoPlayerHandle,
  {
    source: VideoSource;
    /** Audio document: a compact stage with no frame — no fullscreen, no
        drawing, no capture. Timed comments still fade in over the stage. */
    audio?: boolean;
    aspect: number; // width / height; stored value until metadata loads
    storedDuration: number | null;
    annotations: VideoAnnotationItem[];
    /** Annotation to force visible and flash (a source chip was clicked). */
    flashSourceId: string | null;
    /** Draw mode: the drag draws a freehand loop; "Use the whole frame"
        annotates with no loop (region null). */
    drawing: boolean;
    onDrawn: (region: Region | null) => void;
    /** The just-drawn circle, kept visible (dashed) while the composer is open. */
    pendingRegion: Region | null;
    onMetadata: (m: { duration: number; width?: number; height?: number }) => void;
    onTime: (t: number) => void; // ~4 Hz, for the transcript follow-along
    onAnnotate: () => void; // the pencil button; pane opens the composer
    canAnnotate: boolean; // viewers on a shared corpus: false hides the button
  }
>(function VideoPlayer(
  {
    source,
    audio = false,
    aspect,
    storedDuration,
    annotations,
    flashSourceId,
    drawing,
    onDrawn,
    pendingRegion,
    onMetadata,
    onTime,
    onAnnotate,
    canAnnotate,
  },
  ref,
) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(storedDuration ?? 0);
  const [videoAspect, setVideoAspect] = useState(aspect);
  const [waiting, setWaiting] = useState(false);
  // The dictionary key, not the text: the message stays right if the language
  // changes after the error.
  const [error, setError] = useState<"youtubeError" | "videoError" | "audioError" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // The frame's content box inside the stage (letterbox math); the overlay and
  // the frame both size to it, so percent coordinates always mean the frame.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [draw, setDraw] = useState<DrawState>(null);
  const wasPlayingRef = useRef(false);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const onMetadataRef = useRef(onMetadata);
  onMetadataRef.current = onMetadata;

  const seek = useCallback((t: number, opts?: { play?: boolean }) => {
    const engine = engineRef.current;
    if (!engine) return;
    const total = engine.duration();
    const clamped = Math.max(0, total > 0 ? Math.min(t, total) : t);
    engine.seek(clamped);
    setTime(clamped);
    onTimeRef.current(clamped);
    if (opts?.play) engine.play();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seek,
      pause: () => engineRef.current?.pause(),
      time: () => engineRef.current?.time() ?? 0,
      captureAt: async (time: number, region?: Region | null) => {
        const video = videoRef.current;
        if (!video) return null;
        // Capturing straight after a seek catches the frame the player has not
        // replaced yet, so wait for the new one.
        if (Math.abs(video.currentTime - time) > 0.3) {
          await new Promise<void>((resolve) => {
            const done = () => {
              video.removeEventListener("seeked", done);
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(done, 3000);
            video.addEventListener("seeked", done);
            video.currentTime = time;
          });
        }
        return drawFrame(videoRef.current, region);
      },
      capture: (region?: Region | null) => drawFrame(videoRef.current, region),
    }),
    [seek],
  );

  // ── Engines ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (source.kind !== "upload") return;
    const video = videoRef.current;
    if (!video) return;
    engineRef.current = {
      play: () => void video.play(),
      pause: () => video.pause(),
      seek: (t) => {
        video.currentTime = t;
      },
      time: () => video.currentTime,
      duration: () => video.duration || 0,
      setMuted: (m) => {
        video.muted = m;
      },
    };
    return () => {
      engineRef.current = null;
    };
  }, [source.kind]);

  const youtubeId = source.kind === "youtube" ? source.youtubeId : null;
  useEffect(() => {
    if (!youtubeId) return;
    let player: YTPlayerInstance | null = null;
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !ytHostRef.current) return;
      player = new YT.Player(ytHostRef.current, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        // Our controls drive the player; YouTube's own UI stays out of the way.
        playerVars: {
          controls: 0,
          rel: 0,
          playsinline: 1,
          disablekb: 1,
          iv_load_policy: 3,
          fs: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            engineRef.current = {
              play: () => e.target.playVideo(),
              pause: () => e.target.pauseVideo(),
              seek: (t) => e.target.seekTo(t, true),
              time: () => e.target.getCurrentTime(),
              duration: () => e.target.getDuration(),
              setMuted: (m) => (m ? e.target.mute() : e.target.unMute()),
            };
            const total = e.target.getDuration();
            if (total > 0) {
              setDuration(total);
              onMetadataRef.current({ duration: total });
            }
          },
          onStateChange: (e) => {
            // 1 playing, 3 buffering; 0 ended, 2 paused, 5 cued.
            if (e.data === 1) {
              setPlaying(true);
              setWaiting(false);
            } else if (e.data === 3) {
              setWaiting(true);
            } else {
              setPlaying(false);
              setWaiting(false);
            }
          },
          onError: () => setError("youtubeError"),
        },
      });
    });
    return () => {
      cancelled = true;
      engineRef.current = null;
      try {
        player?.destroy();
      } catch {
        // the iframe may already be gone
      }
    };
  }, [youtubeId]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  // Smooth clock: rAF while playing, so the scrubber and overlay track the
  // frame. The transcript follow-along gets ~4 Hz through the same loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastEmit = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        const t = engine.time();
        setTime(t);
        // Some YouTube videos report duration 0 until playback starts.
        const total = engine.duration();
        if (total > 0) setDuration((prev) => (Math.abs(prev - total) > 0.5 ? total : prev));
        if (Math.abs(t - lastEmit) > 0.25) {
          lastEmit = t;
          onTimeRef.current(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Letterbox math: the frame's content box inside the stage. Audio has no
  // frame; its stage is a fixed-height bar and the overlay fills it.
  useEffect(() => {
    if (audio) return;
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const w = Math.min(rect.width, rect.height * videoAspect);
      setBox({ w, h: w / videoAspect });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [videoAspect, audio]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function togglePlay() {
    const engine = engineRef.current;
    if (!engine) return;
    if (playing) engine.pause();
    else engine.play();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === containerRef.current) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  function timeAtPointer(clientX: number): number {
    const track = trackRef.current;
    if (!track || duration === 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function startScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!engineRef.current || duration === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    wasPlayingRef.current = playing;
    engineRef.current.pause();
    seek(timeAtPointer(e.clientX));
  }
  function moveScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seek(timeAtPointer(e.clientX));
  }
  function endScrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (wasPlayingRef.current) engineRef.current?.play();
  }

  // ── Drawing (annotate mode) ───────────────────────────────────────────────
  function overlayPercent(e: React.PointerEvent): { x: number; y: number } | null {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }

  // The drag draws a freehand loop; releasing closes it into the region.
  function startDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    const p = overlayPercent(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    engineRef.current?.pause();
    setDraw({ points: [p] });
  }
  function moveDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = overlayPercent(e);
    if (!p) return;
    const last = draw.points[draw.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.7) return;
    setDraw({ points: [...draw.points, p] });
  }
  function endDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const raw = draw.points;
    setDraw(null);
    // A tap or a tiny scribble is not a loop; ignore it.
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (raw.length < 6 || (spanX < 2 && spanY < 2)) return;
    // Cap the stored point count; the loop closes itself when rendered.
    const step = Math.max(1, Math.ceil(raw.length / 300));
    const points = raw
      .filter((_, i) => i % step === 0)
      .map((p): [number, number] => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
    onDrawn({ kind: "path", points });
  }

  // Annotations visible now: inside their range, or force-shown by a flash.
  const active = useMemo(
    () =>
      new Set(
        annotations
          .filter(
            (a) =>
              (time >= a.startTime && time <= a.endTime) || a.sourceId === flashSourceId,
          )
          .map((a) => a.sourceId),
      ),
    [annotations, time, flashSourceId],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true]")) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seek(Math.max(0, time - 5));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seek(Math.min(duration, time + 5));
    } else if (e.key === "f" && !audio) {
      e.preventDefault();
      toggleFullscreen();
    }
  }

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col overflow-hidden rounded-[24px] shadow-float outline-none"
      style={{ background: STAGE, "--player-text": STAGE_TEXT } as React.CSSProperties}
    >
      {/* Stage: the frame's content box centers inside; overlay matches it
          exactly. The audio stage is a fixed-height bar with the waveform
          decoration — timed comments still fade in over it. */}
      <div
        ref={stageRef}
        className={`relative flex items-center justify-center ${fullscreen ? "min-h-0 flex-1" : ""}`}
        style={fullscreen ? undefined : audio ? { height: 132 } : { aspectRatio: videoAspect }}
      >
        <div
          className={box && !audio ? "relative" : "relative h-full w-full"}
          style={box && !audio ? { width: box.w, height: box.h } : undefined}
        >
          {audio && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px] px-10"
            >
              {AUDIO_BARS.map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full transition-colors duration-300"
                  style={{
                    height: `${h * 0.6}%`,
                    background:
                      duration > 0 && (i / AUDIO_BARS.length) * 100 <= progress
                        ? "var(--clay-400)"
                        : "rgba(245, 234, 216, 0.22)",
                  }}
                />
              ))}
            </div>
          )}
          {source.kind === "upload" ? (
            <video
              ref={videoRef}
              src={source.src}
              preload="metadata"
              playsInline
              muted={muted}
              onClick={drawing ? undefined : togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onWaiting={() => setWaiting(true)}
              onPlaying={() => setWaiting(false)}
              onCanPlay={() => setWaiting(false)}
              onLoadedMetadata={(e) => {
                const video = e.currentTarget;
                setDuration(video.duration);
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                  setVideoAspect(video.videoWidth / video.videoHeight);
                  onMetadataRef.current({
                    duration: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight,
                  });
                } else {
                  // Audio reports no frame size; the duration still matters.
                  onMetadataRef.current({ duration: video.duration });
                }
              }}
              onError={() => setError(audio ? "audioError" : "videoError")}
              className={audio ? "h-full w-full opacity-0" : "h-full w-full"}
            />
          ) : (
            <div className="absolute inset-0">
              <div ref={ytHostRef} className="h-full w-full" />
            </div>
          )}

          {/* The annotation layer: every annotation renders once and fades with
              its range, so replay is a CSS transition, never a mount flash. */}
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {annotations.map((a) => {
              if (!a.region) return null;
              const shared = {
                className: `transition-opacity duration-300 ${
                  active.has(a.sourceId) ? "opacity-100" : "opacity-0"
                }${a.sourceId === flashSourceId ? " video-flash" : ""}`,
                fill: "none",
                stroke: "var(--clay-400)",
                strokeWidth: 2.5,
                strokeLinejoin: "round" as const,
                vectorEffect: "non-scaling-stroke" as const,
                style: { filter: "drop-shadow(0 0 6px rgba(246, 160, 107, 0.55))" },
              };
              return a.region.kind === "ellipse" ? (
                <ellipse
                  key={a.sourceId}
                  cx={a.region.cx}
                  cy={a.region.cy}
                  rx={a.region.rx}
                  ry={a.region.ry}
                  {...shared}
                />
              ) : (
                <path key={a.sourceId} d={regionPathD(a.region.points)} {...shared} />
              );
            })}
            {draw && draw.points.length > 1 && (
              <path
                d={regionPathD(draw.points.map((p): [number, number] => [p.x, p.y]))}
                fill="rgba(246, 160, 107, 0.08)"
                stroke="var(--clay-400)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pendingRegion && !draw && (
              <path
                d={
                  pendingRegion.kind === "path"
                    ? regionPathD(pendingRegion.points)
                    : ellipsePathD(pendingRegion)
                }
                fill="rgba(246, 160, 107, 0.08)"
                stroke="var(--clay-400)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* Comment cards beside their circles; timed comments without a
              circle sit along the bottom. */}
          {annotations.map((a) => {
            const shown = active.has(a.sourceId);
            const bounds = a.region ? regionBounds(a.region) : null;
            const left = bounds
              ? `${Math.min(86, Math.max(6, (bounds.x1 + bounds.x2) / 2))}%`
              : "50%";
            const top = bounds ? `${Math.min(88, bounds.y2 + 3)}%` : undefined;
            const preview = markdownPreview(a.content);
            return (
              <div
                key={a.sourceId}
                data-video-annotation={a.sourceId}
                className={`pointer-events-none absolute max-w-[46%] -translate-x-1/2 rounded-2xl bg-black/65 px-3.5 py-2 text-[12.5px] leading-snug backdrop-blur-sm transition-opacity duration-300 ${
                  shown ? "opacity-100" : "opacity-0"
                }`}
                style={{
                  left,
                  top,
                  bottom: a.region ? undefined : "8%",
                  color: STAGE_TEXT,
                }}
              >
                <span className="mr-2 font-semibold tabular-nums" style={{ color: "var(--clay-400)" }}>
                  {formatTime(a.startTime)}
                </span>
                {preview.length > 220 ? `${preview.slice(0, 220)}…` : preview}
              </div>
            );
          })}

          {/* The iframe swallows clicks, so a catcher above it keeps
              click-to-toggle working; our controls drive the player. */}
          {source.kind === "youtube" && !drawing && (
            <div onClick={togglePlay} className="absolute inset-0" aria-hidden />
          )}

          {/* Draw layer: takes the pointer only in annotate mode. */}
          {drawing && (
            <div
              onPointerDown={startDraw}
              onPointerMove={moveDraw}
              onPointerUp={endDraw}
              className="absolute inset-0 cursor-crosshair touch-none"
            />
          )}
          {drawing && !draw && (
            <button
              onClick={() => onDrawn(null)}
              data-track="video-use-whole-frame"
              className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-semibold backdrop-blur-sm hover:bg-black/85"
              style={{ color: STAGE_TEXT }}
            >
              {t("video.useWholeFrame")}
            </button>
          )}

          {waiting && !error && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={{ color: STAGE_MUTED }}
            >
              <SpinnerIcon size={34} className="motion-safe:animate-spin" />
            </div>
          )}
        </div>

        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm"
            style={{ color: STAGE_MUTED }}
          >
            {t(`video.${error}`)}
          </div>
        )}
      </div>

      {/* Controls: one bar, always visible, markers on the scrubber. */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={togglePlay}
          data-track="video-play"
          aria-label={playing ? t("video.pause") : t("video.play")}
          data-tip={playing ? t("video.pauseSpace") : t("video.playSpace")}
          className={CONTROL_BUTTON}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>

        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: STAGE_MUTED }}>
          <span style={{ color: STAGE_TEXT }}>{formatTime(time)}</span>
          {" / "}
          {formatTime(duration)}
        </span>

        <div
          ref={trackRef}
          onPointerDown={startScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          role="slider"
          aria-label={t("video.seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatTime(time)}
          className="group relative mx-1 h-7 min-w-0 flex-1 cursor-pointer touch-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-clay"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-clay opacity-0 shadow-soft transition-opacity group-hover:opacity-100"
            style={{ left: `${progress}%` }}
          />
          {/* One marker per annotation; click seeks to its start. */}
          {duration > 0 &&
            annotations.map((a) => (
              <button
                key={a.sourceId}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(a.startTime, { play: false });
                }}
                data-track="video-marker"
                aria-label={t("video.annotationAt", { time: formatTime(a.startTime) })}
                data-tip={`${formatTimeRange(a.startTime, a.endTime)} · ${markdownPreview(a.content).slice(0, 80)}`}
                className="absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 bg-clay-300 hover:scale-125"
                style={{ left: `${(a.startTime / duration) * 100}%` }}
              />
            ))}
        </div>

        <button
          onClick={() => setMuted((m) => !m)}
          data-track="video-mute"
          aria-label={muted ? t("video.unmute") : t("video.mute")}
          data-tip={muted ? t("video.unmute") : t("video.mute")}
          className={CONTROL_BUTTON}
        >
          {muted ? <MuteIcon size={17} /> : <VolumeIcon size={17} />}
        </button>

        {canAnnotate && (
        <button
          onClick={onAnnotate}
          data-track="video-annotate"
          aria-label={t("video.annotate")}
          data-tip={audio ? t("video.audioAnnotateTitle") : t("video.annotateTitle")}
          className={
            drawing
              ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-clay text-clay-fg"
              : CONTROL_BUTTON
          }
        >
          <SearchIcon size={17} />
        </button>
        )}

        {!audio && (
        <button
          onClick={toggleFullscreen}
          data-track="video-fullscreen"
          aria-label={fullscreen ? t("video.exitFullscreen") : t("video.fullscreen")}
          data-tip={fullscreen ? t("video.exitFullscreenF") : t("video.fullscreenF")}
          className={CONTROL_BUTTON}
        >
          <FullscreenIcon size={17} />
        </button>
        )}
      </div>
    </div>
  );
});
