/**
 * WeatherPad — the signature XY expressive control for mdrone.
 *
 * Two visual modes (selectable in Settings):
 *   - "flow": flow-field particles + dotted cursor trail
 *   - "minimal": dotted cursor trail only
 *
 * All canvas 2D, transparent background so CSS gradient shows through.
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
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
}

const MAX_PARTICLES = 40;

function noise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const h = (a: number, b: number) => {
    const n = a * 127.1 + b * 311.7;
    return (Math.sin(n) * 43758.5453) % 1;
  };
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
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

  // Store latest climateX/Y in refs so the rAF loop always reads current values
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
    // Record trail in canvas pixel coords
    const el = xyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const trail = trailRef.current;
    trail.push({ x: px, y: py, age: 0 });
    if (trail.length > 50) trail.shift();
  }, [updateXy]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  }, []);

  // Single animation loop — never restarts on prop changes
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

      // Read RMS
      let rms = 0;
      if (analyser && timeBuf) {
        analyser.getByteTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128;
          sum += v * v;
        }
        rms = Math.min(1, Math.sqrt(sum / timeBuf.length) * 3);
        rmsRef.current += (rms - rmsRef.current) * 0.15;
      }
      rms = rmsRef.current;
      const active = rms > 0.01;

      // Always clear to transparent
      ctx.clearRect(0, 0, w, h);

      if (!active) {
        particlesRef.current = [];
        trailRef.current = [];
        return;
      }

      // ── Flow-field particles ────────────────────────────────
      if (vis === "flow") {
        const particles = particlesRef.current;
        const spawnRate = rms * (0.4 + cy * 1.5);
        spawnAccum += spawnRate;
        while (spawnAccum >= 1 && particles.length < MAX_PARTICLES) {
          spawnAccum -= 1;
          particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            life: 0,
            maxLife: 60 + Math.random() * 80,
            size: 1 + Math.random() * 1.5 + rms * 0.5,
          });
        }

        const fieldScale = 0.008;
        const fieldSpeed = 0.3 + cy * 1.2;

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          const n = noise2d(p.x * fieldScale + time * 0.1, p.y * fieldScale + time * 0.05);
          const angle = n * Math.PI * 4 + cy * Math.PI;
          p.x += Math.cos(angle) * fieldSpeed;
          p.y += Math.sin(angle) * fieldSpeed;
          p.life++;

          if (p.life >= p.maxLife || p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) {
            particles.splice(i, 1);
            continue;
          }

          const t = p.life / p.maxLife;
          const alpha = t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1;
          const warmth = cx;
          const r = Math.round(160 + warmth * 60);
          const g = Math.round(110 + warmth * 30);
          const b = Math.round(50 + (1 - warmth) * 50);

          ctx.globalAlpha = alpha * rms * 0.35;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fill();
        }
      }

      // ── Dotted cursor trail ─────────────────────────────────
      const trail = trailRef.current;
      for (let i = 0; i < trail.length; i++) {
        const tp = trail[i];
        const fade = 1 - tp.age / 50;
        if (fade <= 0) continue;
        const recency = trail.length > 1 ? i / (trail.length - 1) : 1;
        const a = fade * fade * recency;
        const dotR = 1.5 + a * 2; // max ~3.5px

        // Subtle halo
        ctx.globalAlpha = a * 0.25;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, dotR + 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(220,190,100,1)";
        ctx.fill();

        // Dot
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = "#dcc070";
        ctx.fill();
      }
      // Age trail
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age++;
        if (trail[i].age > 50) trail.splice(i, 1);
      }

      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [analyser]);

  const gradientStyle = {
    background: `radial-gradient(
      ellipse at ${climateX * 100}% ${(1 - climateY) * 100}%,
      color-mix(in srgb, var(--preview) ${Math.round(5 + climateX * 12)}%, var(--bg-cell)) 0%,
      var(--bg-cell) 70%
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
