"use client";

import { useEffect, useRef, useState } from "react";
import { captureStoryboardFrame } from "@/lib/video/frame-client";

// Visual card frames (SPEC.md §11). An uploaded video seeks a hidden <video>
// through the requested times and draws each frame; a YouTube video cannot be
// drawn from its iframe, so its frames come from the storyboard sheets. Both
// run one at a time — seeking is the slow part — and cache by time.
export type ThumbnailSource =
  | { kind: "upload"; src: string }
  | { kind: "youtube"; documentId: string };

export function useVideoThumbnails(
  source: ThumbnailSource,
  times: number[],
): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const doneRef = useRef(new Set<string>());
  const key = source.kind === "upload" ? source.src : source.documentId;

  useEffect(() => {
    if (source.kind !== "upload") return;
    const video = document.createElement("video");
    video.src = source.src;
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    videoRef.current = video;
    return () => {
      video.removeAttribute("src");
      video.load();
      videoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const keyOf = (t: number) => t.toFixed(1);
    const fresh = times.filter((t) => !doneRef.current.has(keyOf(t)));
    if (fresh.length === 0) return;
    fresh.forEach((t) => doneRef.current.add(keyOf(t)));
    queueRef.current.push(...fresh);

    // A YouTube frame is a fetch and a crop, not a seek.
    if (source.kind === "youtube") {
      const documentId = source.documentId;
      const pump = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        while (queueRef.current.length > 0) {
          const t = queueRef.current.shift()!;
          const dataUrl = await captureStoryboardFrame(documentId, t, null);
          if (dataUrl) setThumbs((prev) => ({ ...prev, [keyOf(t)]: dataUrl }));
        }
        busyRef.current = false;
      };
      void pump();
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const capture = (t: number) =>
      new Promise<string | null>((resolve) => {
        const onSeeked = () => {
          cleanup();
          try {
            if (video.videoWidth === 0) return resolve(null);
            const canvas = document.createElement("canvas");
            const w = 320;
            canvas.width = w;
            canvas.height = Math.round((w * video.videoHeight) / video.videoWidth);
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
          } catch {
            resolve(null);
          }
        };
        const onError = () => {
          cleanup();
          resolve(null);
        };
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          clearTimeout(timer);
        };
        const timer = setTimeout(onError, 8000);
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = Math.max(0.05, t);
      });

    const pump = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (video.readyState === 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            video.removeEventListener("loadedmetadata", done);
            video.removeEventListener("error", done);
            resolve();
          };
          video.addEventListener("loadedmetadata", done);
          video.addEventListener("error", done);
        });
      }
      while (queueRef.current.length > 0 && videoRef.current === video) {
        const t = queueRef.current.shift()!;
        const dataUrl = await capture(t);
        if (dataUrl) setThumbs((prev) => ({ ...prev, [keyOf(t)]: dataUrl }));
      }
      busyRef.current = false;
    };
    void pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, key]);

  return thumbs;
}
