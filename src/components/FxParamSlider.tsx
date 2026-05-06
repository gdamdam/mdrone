import { TouchSlider } from "./TouchSlider";

interface FxParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  midiId?: string;
}

export function FxParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  midiId,
}: FxParamSliderProps) {
  return (
    <div className="fx-param-row">
      <span className="fx-param-label">{label}</span>
      <TouchSlider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className="fx-param-slider"
        aria-label={label}
        midiId={midiId}
      />
      <span className="fx-param-value">
        {step < 0.01 ? value.toFixed(3) : step < 1 ? value.toFixed(2) : Math.round(value)}
        {unit}
      </span>
    </div>
  );
}
