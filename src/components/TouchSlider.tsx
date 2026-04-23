import { useCallback, useRef } from "react";

type Orientation = "horizontal" | "vertical";

type TouchSliderProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  className?: string;
  orientation?: Orientation;
  style?: React.CSSProperties;
  "aria-label"?: string;
  title?: string;
};

/**
 * Wraps <input type="range"> with a pointer-drag overlay so the whole
 * row is draggable — not just the thumb. Native input is preserved
 * underneath for keyboard + screen readers.
 */
export function TouchSlider({
  value,
  min,
  max,
  step,
  onChange,
  className,
  orientation = "horizontal",
  style,
  title,
  "aria-label": ariaLabel,
}: TouchSliderProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const valueFromPointer = useCallback(
    (clientX: number, clientY: number): number => {
      const el = wrapRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const raw =
        orientation === "vertical"
          ? (rect.bottom - clientY) / rect.height
          : (clientX - rect.left) / rect.width;
      const ratio = Math.min(1, Math.max(0, raw));
      const span = max - min;
      const stepped = Math.round((ratio * span) / step) * step + min;
      return Math.min(max, Math.max(min, stepped));
    },
    [min, max, step, orientation, value],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    inputRef.current?.focus({ preventScroll: true });
    const v = valueFromPointer(e.clientX, e.clientY);
    if (v !== value) onChange(v);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const v = valueFromPointer(e.clientX, e.clientY);
    if (v !== value) onChange(v);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <span
      ref={wrapRef}
      className={
        orientation === "vertical"
          ? "touch-slider touch-slider-vertical"
          : "touch-slider"
      }
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={className}
        aria-label={ariaLabel}
        style={style}
      />
    </span>
  );
}
