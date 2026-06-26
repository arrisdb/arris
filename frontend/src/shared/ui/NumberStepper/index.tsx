import type { ChangeEvent, FocusEvent } from "react";

function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  "aria-label"?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const precision = String(step).includes(".") ? String(step).split(".")[1].length : 0;

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "" || raw === "-") return;
    const n = Number(raw);
    if (!isNaN(n)) onChange(clamp(Number(n.toFixed(precision))));
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (isNaN(n) || e.target.value === "") onChange(clamp(min));
  };

  return (
    <span className="mdbc-stepper" aria-label={ariaLabel}>
      <button
        className="mdbc-stepper-btn"
        onClick={() => onChange(clamp(Number((value - step).toFixed(precision))))}
        disabled={value <= min}
        aria-label="Decrease"
        type="button"
      >
        −
      </button>
      <input
        className="mdbc-stepper-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleInput}
        onBlur={handleBlur}
      />
      {suffix && <span className="mdbc-stepper-suffix">{suffix}</span>}
      <button
        className="mdbc-stepper-btn"
        onClick={() => onChange(clamp(Number((value + step).toFixed(precision))))}
        disabled={value >= max}
        aria-label="Increase"
        type="button"
      >
        +
      </button>
    </span>
  );
}

export {
  NumberStepper,
};
