"use client";

import { useEffect, useRef } from "react";

// The glow while a reader circles a figure or equation. reader-interactions
// dispatches dissect:circle-glow with viewport coordinates as the pointer
// draws; this canvas trails a comet of warm gold sparkles behind it and lets
// the trail fade once the circle ends. Idle until a start event: no rAF loop,
// nothing drawn.
type CircleGlowDetail = {
  phase: "start" | "move" | "end";
  x: number;
  y: number;
  blockId: string;
};

type TrailPoint = { x: number; y: number; born: number };
type Mote = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number };

const TRAIL_LIFE = 600; // ms a trail sparkle takes to decay
const TRAIL_MAX = 90; // points kept; older ones are expired anyway

export function CircleGlow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points: TrailPoint[] = [];
    const motes: Mote[] = [];
    let drawing = false; // pointer down, points still arriving
    let raf = 0;

    function fit() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnMote(x: number, y: number) {
      motes.push({
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 0.04,
        vy: -0.02 - Math.random() * 0.03, // drift gently upward
        born: performance.now(),
        life: 400 + Math.random() * 200,
        size: 0.8 + Math.random() * 1.6,
      });
    }

    function frame(now: number) {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Additive blending: overlapping sparkles brighten, the comet core glows.
      ctx.globalCompositeOperation = "lighter";

      let alive = false;
      for (const p of points) {
        const age = now - p.born;
        if (age >= TRAIL_LIFE) continue;
        alive = true;
        const fade = 1 - age / TRAIL_LIFE;
        // Warm gold with a subtle hue shimmer between amber and clay.
        const hue = 32 + 8 * Math.sin(now / 180 + p.born / 90);
        const radius = 5 + 15 * fade;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        glow.addColorStop(0, `hsla(48, 95%, 82%, ${0.5 * fade})`);
        glow.addColorStop(0.35, `hsla(${hue}, 85%, 62%, ${0.3 * fade})`);
        glow.addColorStop(1, `hsla(${hue}, 85%, 55%, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        const age = now - m.born;
        if (age >= m.life) {
          motes.splice(i, 1);
          continue;
        }
        alive = true;
        const fade = 1 - age / m.life;
        m.x += m.vx * 16;
        m.y += m.vy * 16;
        ctx.fillStyle = `hsla(45, 95%, 78%, ${0.8 * fade})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * fade, 0, Math.PI * 2);
        ctx.fill();
      }

      if (drawing || alive) {
        raf = requestAnimationFrame(frame);
      } else {
        // Trail fully faded: stop the loop and leave the canvas clear.
        raf = 0;
        points.length = 0;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    function addPoint(x: number, y: number) {
      points.push({ x, y, born: performance.now() });
      if (points.length > TRAIL_MAX) points.splice(0, points.length - TRAIL_MAX);
      if (Math.random() < 0.35) spawnMote(x, y);
    }

    function onGlow(e: Event) {
      const detail = (e as CustomEvent<Partial<CircleGlowDetail>>).detail;
      if (!detail || typeof detail.x !== "number" || typeof detail.y !== "number") return;
      if (detail.phase === "start") {
        fit();
        drawing = true;
        addPoint(detail.x, detail.y);
        if (raf === 0) raf = requestAnimationFrame(frame);
      } else if (detail.phase === "move") {
        if (!drawing) return;
        addPoint(detail.x, detail.y);
      } else if (detail.phase === "end") {
        drawing = false; // the loop runs on until the trail fades
      }
    }

    function onResize() {
      if (raf !== 0) fit();
    }

    window.addEventListener("dissect:circle-glow", onGlow);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("dissect:circle-glow", onGlow);
      window.removeEventListener("resize", onResize);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] print:hidden"
    />
  );
}
