/**
 * WeatherPad — the signature XY expressive control for mdrone.
 *
 * Visual layers (all canvas 2D, no WebGL):
 *   1. Spectral aurora — horizontal bands whose height/opacity respond
 *      to FFT frequency bands. Breathes with the drone's harmonics.
 *   2. Flow-field particles — follow a coherent noise field that
 *      rotates with Y (motion axis). Not random scatter.
 *   3. Cursor wake — luminous trail when dragging.
 *   4. Position-reactive gradient background (CSS).
 */

import { useCallback, useEffect, useRef } from "react";

interface WeatherPadProps {
  climateX: number;
  climateY: number;
  onChange: (x: number, y: number) => void;
  intro: boolean;
  onDismissIntro: () => void;
  analyser: AnalyserNode | null;
  visual?: "flow" | "aurora" | "minimal";
}

interface Particle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
}

const MAX_PARTICLES = 50;

// Simple 2D value noise for flow field (no library needed)
function noise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Hash corners
  const h = (a: number, b: number) => {
    const n = a * 127.1 + b * 311.7;
    return (Math.sin(n) * 43758.5453) % 1;
  };
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  // Smooth interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function WeatherPad({
  climateX,
  climateY,
  onChange,
  intro,
  onDismissIntro,
  analyser,
  visual = "flow",
}: WeatherPadProps) {
  const xyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const rmsRef = useRef(0);
  const timeRef = useRef(0);
  // Cursor wake trail
  const trailRef = useRef<{ x: number; y: number; age: number }[]>([]);

  // ── Pointer handling ────────────────────────────────────────────
  const updateXy = useCallback((clientX: number, clientY: number) => {
    const el = xyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    onChange(x, y);
    // Record trail point
    const trail = trailRef.current;
    trail.push({ x: x * rect.width, y: (1 - y) * rect.height, age: 0 });
    if (trail.length > 40) trail.shift();
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

  // ── Visual feedback ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = xyRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // FFT for spectral bands (smaller FFT = cheaper)
    const fftSize = analyser ? Math.min(analyser.fftSize, 256) : 0;
    const freqBuf = analyser ? new Uint8Array(fftSize / 2) : null;
    const timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
    let raf = 0;
    let spawnAccum = 0;

    // Clear state on visual mode switch
    particlesRef.current = [];
    trailRef.current = [];

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

      // Read audio data
      let rms = 0;
      const bands = [0, 0, 0, 0, 0, 0]; // 6 spectral bands
      if (analyser && timeBuf && freqBuf) {
        analyser.getByteTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const v = (timeBuf[i] - 128) / 128;
          sum += v * v;
        }
        rms = Math.min(1, Math.sqrt(sum / timeBuf.length) * 3);
        rmsRef.current += (rms - rmsRef.current) * 0.15;

        // FFT bands
        analyser.getByteFrequencyData(freqBuf);
        const binCount = freqBuf.length;
        const bandSize = Math.floor(binCount / bands.length);
        for (let b = 0; b < bands.length; b++) {
          let bandSum = 0;
          for (let i = b * bandSize; i < (b + 1) * bandSize && i < binCount; i++) {
            bandSum += freqBuf[i];
          }
          bands[b] = (bandSum / bandSize) / 255;
        }
      }
      rms = rmsRef.current;

      const cx = climateX;
      const cy = climateY;
      const active = rms > 0.01;

      // Clear — use transparent clear so the CSS gradient shows through.
      // Partial clear (compositing trick) for motion blur on active visuals.
      if (active && visual !== "minimal") {
        // Semi-transparent overlay fades previous frame for trail persistence
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      if (!active) {
        ctx.clearRect(0, 0, w, h);
        const particles = particlesRef.current;
        for (let i = particles.length - 1; i >= 0; i--) {
          particles[i].life += 4;
          if (particles[i].life >= particles[i].maxLife) particles.splice(i, 1);
        }
        trailRef.current = [];
        return;
      }

      // ── Layer 1: Spectral aurora bands (aurora + flow modes)
      if (visual !== "minimal") {
      const bandH = h / bands.length;
      for (let b = 0; b < bands.length; b++) {
        const energy = bands[b] * rms;
        if (energy < 0.02) continue;
        const bandY = h - (b + 0.5) * bandH;
        const warmth = cx;
        const r = Math.round(120 + warmth * 100 + b * 15);
        const g = Math.round(80 + warmth * 50 - b * 5);
        const bl = Math.round(40 + (1 - warmth) * 80 + b * 20);
        // Horizontal gradient band
        const grad = ctx.createLinearGradient(0, bandY - bandH * 0.4, 0, bandY + bandH * 0.4);
        grad.addColorStop(0, `rgba(${r},${g},${bl},0)`);
        grad.addColorStop(0.5, `rgba(${r},${g},${bl},${(energy * 0.25).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        // Shift band position with time and Y axis (motion)
        const drift = Math.sin(time * 0.3 + b * 1.2) * cy * 15;
        ctx.fillRect(0, bandY - bandH * 0.5 + drift, w, bandH);
      }

      } // end aurora layer

      // ── Layer 2: Flow-field particles (flow mode only) ──────
      if (visual === "flow") {
      const particles = particlesRef.current;
      const spawnRate = rms * (0.3 + cy * 2);
      spawnAccum += spawnRate;
      while (spawnAccum >= 1 && particles.length < MAX_PARTICLES) {
        spawnAccum -= 1;
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          life: 0,
          maxLife: 60 + Math.random() * 100,
          size: 1 + Math.random() * 2 + rms,
        });
      }

      // Flow field parameters — rotation based on Y (motion)
      const fieldScale = 0.008;
      const fieldSpeed = 0.3 + cy * 1.5;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        // Flow field direction from noise
        const n = noise2d(p.x * fieldScale + time * 0.1, p.y * fieldScale + time * 0.05);
        const angle = n * Math.PI * 4 + cy * Math.PI; // Y rotates the field
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
        const r = Math.round(180 + warmth * 75);
        const g = Math.round(130 + warmth * 30);
        const b = Math.round(60 + (1 - warmth) * 60);

        ctx.globalAlpha = alpha * rms * 0.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
      }

      } // end flow field layer

      // ── Layer 3: Dotted glowing trail (all modes) ───────────
      // Evenly-spaced dots along the trail path, each with a soft
      // radial glow halo. Most recent = largest/brightest, fading
      // to tiny dim embers at the tail. The trail breathes with RMS.
      const trail = trailRef.current;
      const trailLen = trail.length;
      if (trailLen > 1) {
        // Draw dots from oldest to newest so newest renders on top
        for (let i = 0; i < trailLen; i++) {
          const tp = trail[i];
          const fade = 1 - tp.age / 50;
          if (fade <= 0) continue;
          // Position in trail: 0 = oldest, 1 = newest
          const recency = i / (trailLen - 1);
          const glow = fade * fade * recency;
          const dotR = 1 + glow * 5;
          const glowR = dotR * 3;
          const brightness = Math.max(0.3, rms);

          // Soft radial glow halo
          const grad = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, glowR);
          grad.addColorStop(0, `rgba(232,204,120,${(glow * brightness * 0.7).toFixed(3)})`);
          grad.addColorStop(0.3, `rgba(232,180,80,${(glow * brightness * 0.3).toFixed(3)})`);
          grad.addColorStop(1, `rgba(232,160,60,0)`);
          ctx.globalAlpha = 1;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, glowR, 0, Math.PI * 2);
          ctx.fill();

          // Sharp bright core
          ctx.globalAlpha = glow * brightness;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = "#f0d878";
          ctx.fill();
        }
      }
      // Age trail points
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
  }, [analyser, climateX, climateY, visual]);

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
