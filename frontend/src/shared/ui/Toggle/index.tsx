function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`mdbc-toggle${checked ? " checked" : ""}`}
    >
      <span className="mdbc-toggle-knob" />
    </button>
  );
}

export {
  Toggle,
};
