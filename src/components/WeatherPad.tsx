/**
 * WeatherPad — the signature XY expressive control for mdrone.
 *
 * Visual modes: "flow" (particles + trail) or "minimal" (trail only).
 * Canvas uses destination-out compositing for motion blur persistence.
 */

import { useCallback, useEffect, useRef } from "react";

interface WeatherPadProps {
  climateX: number;
  climateY: number;
  onChange: (x: number, y: number) => void;
  intro: boolean;
  onDismissIntro: () => void;
  analyser: AnalyserNode | null;
  visual?: "flow" | "minimal";
}

interface Particle {
  x: number; y: number; life: number; maxLife: number; size: number;
}

const MAX_PARTICLES = 60;

function noise2d(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (a: number, b: number) => (Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function WeatherPad({
  climateX, climateY, onChange, intro, onDismissIntro, analyser,
  visual = "flow",
}: WeatherPadProps) {
  const xyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const rmsRef = useRef(0);
  const timeRef = useRef(0);
  const trailRef = useRef<{ x: number; y: number; age: number }[]>([]);
  const visualRef = useRef(visual);
  useEffect(() => { visualRef.current = visual; }, [visual]);
  const cxRef = useRef(climateX);
  const cyRef = useRef(climateY);
  useEffect(() => { cxRef.current = climateX; }, [climateX]);
  useEffect(() => { cyRef.current = climateY; }, [climateY]);

  const updateXy = useCallback((clientX: number, clientY: number) => {
    const el = xyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    onChange(x, y);
  }, [onChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    onDismissIntro();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    updateXy(e.clientX, e.clientY);
  }, [updateXy, onDismissIntro]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateXy(e.clientX, e.clientY);
    const el = xyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    trailRef.current.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      age: 0,
    });
    if (trailRef.current.length > 60) trailRef.current.shift();
  }, [updateXy]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = xyRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
    let raf = 0;
    let spawnAccum = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      timeRef.current += 0.016;
      const time = timeRef.current;
      const vis = visualRef.current;
      const cx = cxRef.current;
      const cy = cyRef.current;

      // RMS
      if (analyser && timeBuf) {
        analyser.getByteTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128; sum += v * v;
        }
        rmsRef.current += (Math.min(1, Math.sqrt(sum / timeBuf.length) * 3) - rmsRef.current) * 0.15;
      }
      const rms = rmsRef.current;
      const active = rms > 0.01;

      // Motion blur: fade previous frame instead of clearing.
      // destination-out erases at the given alpha, leaving trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = active ? 0.08 : 0.3; // slower fade when active = longer trails
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      if (!active) {
        // Let existing content fade out via the destination-out above
        return;
      }

      // ── Flow-field particles ────────────────────────────────
      if (vis === "flow") {
        const particles = particlesRef.current;
        spawnAccum += rms * (0.5 + cy * 2);
        while (spawnAccum >= 1 && particles.length < MAX_PARTICLES) {
          spawnAccum -= 1;
          particles.push({
            x: Math.random() * w, y: Math.random() * h,
            life: 0, maxLife: 80 + Math.random() * 100,
            size: 2 + Math.random() * 2,
          });
        }

        const fieldScale = 0.006;
        const fieldSpeed = 0.4 + cy * 1.5;
        const warmth = cx;
        const r = Math.round(180 + warmth * 60);
        const g = Math.round(120 + warmth * 30);
        const b = Math.round(50 + (1 - warmth) * 50);

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          const n = noise2d(p.x * fieldScale + time * 0.08, p.y * fieldScale + time * 0.04);
          const angle = n * Math.PI * 4 + cy * Math.PI * 0.5;
          p.x += Math.cos(angle) * fieldSpeed;
          p.y += Math.sin(angle) * fieldSpeed;
          p.life++;

          if (p.life >= p.maxLife || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
            particles.splice(i, 1);
            continue;
          }

          const t = p.life / p.maxLife;
          const alpha = (t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1);

          // Draw particle — the motion blur handles the trail effect
          ctx.globalAlpha = alpha * (0.15 + rms * 0.35);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fill();
        }
      }

      // ── Cursor trail dots ───────────────────────────────────
      const trail = trailRef.current;
      for (let i = 0; i < trail.length; i++) {
        const tp = trail[i];
        const fade = Math.max(0, 1 - tp.age / 60);
        if (fade <= 0) continue;
        const recency = trail.length > 1 ? i / (trail.length - 1) : 1;
        const a = fade * recency;
        const dotR = 1.5 + a * 2;

        ctx.globalAlpha = a * 0.6;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = "#dcc070";
        ctx.fill();
      }
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age++;
        if (trail[i].age > 60) trail.splice(i, 1);
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [analyser]);

  const gradientStyle = {
    background: `radial-gradient(
      circle at ${climateX * 100}% ${(1 - climateY) * 100}%,
      color-mix(in srgb, var(--preview) ${Math.round(3 + climateX * 5)}%, var(--bg-cell)) 0%,
      var(--bg-cell) 20%
    )`,
  };

  return (
    <div className="weather-section">
      <div className="weather-header">
        <span className={`weather-title${intro ? " weather-title-intro" : ""}`}>WEATHER</span>
        <span className={`weather-hint${intro ? " weather-hint-intro" : ""}`}>drag to change the room</span>
      </div>
      <div
        ref={xyRef}
        className="climate-xy weather-xy"
        style={gradientStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        title="Weather — X: DARK ↔ BRIGHT   Y: STILL ↔ MOVING"
      >
        <canvas ref={canvasRef} className="weather-canvas" />
        <div
          className="climate-cursor"
          style={{ left: `${climateX * 100}%`, bottom: `${climateY * 100}%` }}
        />
        <span className="climate-axis climate-axis-x-left">DARK</span>
        <span className="climate-axis climate-axis-x-right">BRIGHT</span>
        <span className="climate-axis climate-axis-y-top">MOVING</span>
        <span className="climate-axis climate-axis-y-bot">STILL</span>
      </div>
    </div>
  );
}
