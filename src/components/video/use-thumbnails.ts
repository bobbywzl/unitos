"use client";

import { useEffect, useRef, useState } from "react";

// Deck card thumbnails: one hidden <video> element seeks through the requested
// times and draws each frame to a canvas. Serial queue — seeking is the slow
// part — and every captured frame caches by its time for the session.
export function useVideoThumbnails(src: string, times: number[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const doneRef = useRef(new Set<string>());

  useEffect(() => {
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    videoRef.current = video;
    return () => {
      video.removeAttribute("src");
      video.load();
      videoRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const keyOf = (t: number) => t.toFixed(1);
    const fresh = times.filter((t) => !doneRef.current.has(keyOf(t)));
    if (fresh.length === 0) return;
    fresh.forEach((t) => doneRef.current.add(keyOf(t)));
    queueRef.current.push(...fresh);

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
  }, [times]);

  return thumbs;
}
