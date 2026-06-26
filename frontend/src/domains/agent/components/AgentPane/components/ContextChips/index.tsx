import type { ContextChip } from "../../types";

function ContextChips({
  chips,
  onRemove,
}: {
  chips: ContextChip[];
  onRemove: (id: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="mdbc-agent-chips">
      {chips.map((chip) => (
        <span key={chip.id} className="mdbc-agent-chip" title={chip.text}>
          {chip.label}
          <button
            type="button"
            className="mdbc-agent-chip-remove"
            aria-label={`Remove ${chip.label}`}
            onClick={() => onRemove(chip.id)}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

export { ContextChips };
