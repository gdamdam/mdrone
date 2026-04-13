import { useEffect, useRef } from "react";

/** Tiny stereo peak meter driven by a shared master AnalyserNode.
 *  Canvas-based so it refreshes without causing React rerenders. */
export function VuMeter({
  analyser,
  width = 240,
  height = 10,
}: {
  analyser: AnalyserNode | null;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!analyser) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = new Uint8Array(analyser.fftSize);
    let peakHold = 0;
    let peakDecay = 0;
    let raf = 0;
    let lastPaint = -Infinity;
    const FRAME_MS = 1000 / 30;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        const a = Math.abs(v);
        sum += v * v;
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 3);
      const peakLvl = Math.min(1, peak * 1.05);
      if (peakLvl > peakHold) {
        peakHold = peakLvl;
        peakDecay = 0;
      } else {
        peakDecay += 0.008;
        peakHold = Math.max(0, peakHold - peakDecay);
      }
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      ctx.clearRect(0, 0, W, H);

      // Symmetrical centre-out fill: level spreads from the centre
      // toward both edges simultaneously.
      const halfW = cx * level;

      // Gradient: centre warm → edge hot → clip red
      const gradR = ctx.createLinearGradient(cx, 0, W, 0);
      gradR.addColorStop(0, "#d06a24");
      gradR.addColorStop(0.7, "#e59443");
      gradR.addColorStop(0.9, "#ffcc55");
      gradR.addColorStop(1, "#ff4040");
      ctx.fillStyle = gradR;
      ctx.fillRect(cx, 0, halfW, H);

      // Mirror to the left
      const gradL = ctx.createLinearGradient(cx, 0, 0, 0);
      gradL.addColorStop(0, "#d06a24");
      gradL.addColorStop(0.7, "#e59443");
      gradL.addColorStop(0.9, "#ffcc55");
      gradL.addColorStop(1, "#ff4040");
      ctx.fillStyle = gradL;
      ctx.fillRect(cx - halfW, 0, halfW, H);

      // Peak hold markers — mirrored
      const peakOff = Math.min(cx - 1, Math.floor(cx * peakHold));
      ctx.fillStyle = "#ffe6a8";
      ctx.fillRect(cx + peakOff, 0, 2, H);
      ctx.fillRect(cx - peakOff - 2, 0, 2, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return (
    <div className="vu-meter" title="Master output level">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="vu-meter-canvas"
      />
    </div>
  );
}
