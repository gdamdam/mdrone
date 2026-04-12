/**
 * WeatherPad — the signature XY expressive control for mdrone.
 *
 * Extracted from DroneView to keep the component focused and enable
 * richer visual feedback. The pad renders:
 *   - a gradient background that shifts with cursor position
 *     (dark↔bright on X, calm↔turbulent on Y)
 *   - a canvas overlay with drifting particles whose speed and
 *     density respond to Y position + audio RMS
 *   - the cursor dot with glow
 *   - axis labels
 */

import { useCallback, useEffect, useRef } from "react";

interface WeatherPadProps {
  climateX: number;
  climateY: number;
  onChange: (x: number, y: number) => void;
  /** Show intro glow emphasis */
  intro: boolean;
  onDismissIntro: () => void;
  /** Master analyser for audio-reactive particles (optional) */
  analyser: AnalyserNode | null;
}

// Particle state for the canvas overlay
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

const MAX_PARTICLES = 60;
const SPAWN_RATE_BASE = 0.3;   // particles per frame at Y=0
const SPAWN_RATE_PEAK = 2.5;   // particles per frame at Y=1

export function WeatherPad({
  climateX,
  climateY,
  onChange,
  intro,
  onDismissIntro,
  analyser,
}: WeatherPadProps) {
  const xyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const rmsRef = useRef(0);

  // ── Pointer handling ────────────────────────────────────────────
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
  }, [updateXy]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  }, []);

  // ── Visual feedback: gradient + particles ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = xyRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
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
      const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));

      // Read RMS from analyser
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        rmsRef.current += (rms - rmsRef.current) * 0.15;
      }

      const rms = rmsRef.current;
      const cx = climateX;
      const cy = climateY;
      const particles = particlesRef.current;

      // Spawn particles — rate increases with Y (motion) and RMS
      const spawnRate = SPAWN_RATE_BASE + (SPAWN_RATE_PEAK - SPAWN_RATE_BASE) * cy * (0.4 + rms * 0.6);
      spawnAccum += spawnRate;
      while (spawnAccum >= 1 && particles.length < MAX_PARTICLES) {
        spawnAccum -= 1;
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.2 + cy * 1.2 + rms * 0.8) * (0.5 + Math.random());
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 40 + Math.random() * 80,
          size: 1 + Math.random() * 2 + rms * 1.5,
        });
      }

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        // Fade in/out
        const t = p.life / p.maxLife;
        const alpha = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;

        if (p.life >= p.maxLife || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
          particles.splice(i, 1);
          continue;
        }

        // Color: warm on bright side (high X), cool on dark side (low X)
        const warmth = cx;
        const r = Math.round(180 + warmth * 75);
        const g = Math.round(120 + warmth * 40);
        const b = Math.round(60 + (1 - warmth) * 80);

        ctx.globalAlpha = alpha * (0.15 + rms * 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [analyser, climateX, climateY]);

  // Gradient style driven by climate position
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
        <canvas
          ref={canvasRef}
          className="weather-canvas"
        />
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
