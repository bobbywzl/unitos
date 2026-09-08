"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilmIcon, SpinnerIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// A figure's video is the page's own file, requested from the page's own
// host. It often does not arrive — the host refuses a request from another
// origin, the link has expired, the reader is offline — and a video that
// does not load draws as nothing, so the caption reads as if the clip were
// never there.
//
// Every video of a rendered figure gets its place: while it loads, a spinner
// and "Loading the video…"; when it does not load, the film icon, "This
// figure is a video. It is not loading." and Try again. The place is
// [data-anchor-skip], so the block's DOM text stays exactly the caption
// (SPEC.md §5).

// A video that loads at once shows no place: the place waits this long
// first, so the common case never flickers.
const PLACE_AFTER_MS = 1_200;
// A video with no metadata by now is not loading. Long enough for a large
// clip on a slow line.
const LOAD_WAIT_MS = 15_000;

// waiting = the video is loading and no place shows yet; loading = the place
// says it is loading; failed = the place says it is not loading; loaded = the
// video is there and the place is gone.
type PlaceState = "waiting" | "loading" | "failed" | "loaded";

type Place = { index: number; host: HTMLElement; video: HTMLVideoElement; state: PlaceState };

/** The video has told us the file is reachable: its metadata is in. */
function reachable(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_METADATA;
}

/** The video has told us the file is not reachable. */
function unreachable(video: HTMLVideoElement): boolean {
  return video.error !== null || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
}

function stateOf(video: HTMLVideoElement): PlaceState {
  if (reachable(video)) return "loaded";
  if (unreachable(video)) return "failed";
  return "waiting";
}

/** One place per video of the rendered html, its state kept current, and the
    Try again that starts a video's request over. The places are rebuilt
    whenever the html changes. */
function useVideoPlaces(
  ref: React.RefObject<HTMLDivElement | null>,
  html: string,
): { places: Place[]; retry: (place: Place) => void } {
  const [places, setPlaces] = useState<Place[]>([]);
  // The wait a Try again starts, cleared when the reader leaves the block.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    const root = ref.current;
    const videos = root ? Array.from(root.querySelectorAll("video")) : [];
    if (videos.length === 0) {
      setPlaces([]);
      return;
    }
    const entries = videos.map((video, index) => {
      const host = document.createElement("span");
      host.setAttribute("data-anchor-skip", "");
      host.className = "video-place-host";
      video.before(host);
      return { index, host, video, state: stateOf(video) };
    });
    setPlaces(entries);

    // A place only moves forward: loaded is final, failed gives way to loaded
    // alone, and the wait that shows the place moves waiting on and nothing
    // else — a video that failed before the wait was up stays failed.
    const move = (index: number, next: (state: PlaceState) => PlaceState) =>
      setPlaces((prev) => prev.map((p) => (p.index === index ? { ...p, state: next(p.state) } : p)));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off: (() => void)[] = [];
    const on = (target: EventTarget, name: string, fn: () => void) => {
      target.addEventListener(name, fn);
      off.push(() => target.removeEventListener(name, fn));
    };

    for (const { index, video } of entries) {
      const loaded = () => move(index, () => "loaded");
      const failed = () => move(index, (state) => (state === "loaded" ? state : "failed"));
      // Metadata is enough: the file is reachable. The first frame may wait
      // for a play the reader never asks for (preload="metadata").
      for (const name of ["loadedmetadata", "loadeddata", "canplay", "playing"]) {
        on(video, name, loaded);
      }
      on(video, "error", failed);
      // A <source> that cannot load reports on the source, not on the video.
      for (const source of video.querySelectorAll("source")) on(source, "error", failed);
      timers.push(
        setTimeout(() => {
          move(index, (state) => (state === "waiting" ? "loading" : state));
        }, PLACE_AFTER_MS),
        setTimeout(() => {
          if (!reachable(video)) failed();
        }, LOAD_WAIT_MS),
      );
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const remove of off) remove();
      for (const { host } of entries) host.remove();
    };
  }, [ref, html]);

  // The video hides while its place stands, so the two never stack; the
  // place's own box goes once the video is there, so it takes no room in the
  // figure.
  useEffect(() => {
    for (const place of places) {
      const shown = place.state === "loading" || place.state === "failed";
      place.video.classList.toggle("video-not-loaded", shown);
      place.host.classList.toggle("video-place-empty", !shown);
    }
  }, [places]);

  // Try again: the request starts over from the top and the place says it is
  // loading again. The listeners still stand, so they report the new attempt.
  const retry = useCallback((place: Place) => {
    const move = (next: (state: PlaceState) => PlaceState) =>
      setPlaces((prev) =>
        prev.map((p) => (p.index === place.index ? { ...p, state: next(p.state) } : p)),
      );
    move(() => "loading");
    place.video.load();
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      if (!reachable(place.video)) move((state) => (state === "loaded" ? state : "failed"));
    }, LOAD_WAIT_MS);
  }, []);

  return { places, retry };
}

/** The video's place: what it is, and what it is doing. */
function VideoPlace({ state, onRetry }: { state: "loading" | "failed"; onRetry: () => void }) {
  const t = useT();
  const shell = "figure-place my-2 flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] leading-snug";
  if (state === "loading") {
    return (
      <span role="status" aria-live="polite" className={`${shell} bg-sand-100 text-sand-700`}>
        <SpinnerIcon size={18} className="shrink-0 text-clay motion-safe:animate-spin" />
        <span className="thinking-label font-medium">{t("panes.videoLoading")}</span>
      </span>
    );
  }
  return (
    <span role="alert" className={`${shell} bg-sand-100 text-sand-700`}>
      <FilmIcon size={18} className="shrink-0 text-sand-500" />
      <span className="min-w-0 flex-1">{t("panes.videoNotLoading")}</span>
      <button
        type="button"
        data-track="video-retry"
        onClick={onRetry}
        className="shrink-0 rounded-full bg-card px-2.5 py-1 text-[12px] font-semibold text-sand-700 shadow-soft hover:text-clay-800"
      >
        {t("panes.figureTryAgain")}
      </button>
    </span>
  );
}

/** A figure or table rendered from the parser's html, with a place for every
    video that has not loaded. */
export function MediaHtml({
  blockId,
  sourceId,
  className,
  html,
}: {
  blockId: string;
  sourceId?: string;
  className: string;
  html: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { places, retry } = useVideoPlaces(ref, html);
  return (
    <>
      <div
        ref={ref}
        data-block-id={blockId}
        data-source-id={sourceId}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {places.map((place) =>
        place.state === "loading" || place.state === "failed"
          ? createPortal(
              <VideoPlace state={place.state} onRetry={() => retry(place)} />,
              place.host,
              String(place.index),
            )
          : null,
      )}
    </>
  );
}
