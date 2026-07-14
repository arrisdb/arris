import { DEFAULT_TEXT_BG, DEFAULT_TEXT_COLOR } from "../../constants";
import type { SectionProps } from "../../types";
import { ALIGN_OPTIONS, STYLE_TOGGLES } from "./constants";
import { SegmentedIconRow } from "./components/SegmentedIconRow";

/// Text-specific controls: font size, run styles (bold/italic/underline/strike),
/// alignment, and text/background colour. All write into the object's `style`,
/// which the TextNode renderer consumes. Each control sits in a label-left row.
function TextSection({ component, onChange }: SectionProps) {
  if (component.kind !== "text") return null;
  const style = component.style ?? {};
  const align = style.align ?? "left";

  return (
    <div className="mdbc-pane-form">
      <label className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Font size</span>
        <input
          type="number"
          className="mdbc-pane-input"
          value={style.fontSize ?? 16}
          onChange={(e) =>
            onChange({ style: { ...style, fontSize: Math.max(1, Number(e.target.value)) } })
          }
        />
      </label>
      <SegmentedIconRow
        label="Style"
        options={STYLE_TOGGLES}
        isActive={(id) => !!style[id]}
        onSelect={(id) => onChange({ style: { ...style, [id]: !style[id] } })}
      />
      <SegmentedIconRow
        label="Align"
        options={ALIGN_OPTIONS}
        isActive={(id) => align === id}
        onSelect={(id) => onChange({ style: { ...style, align: id } })}
      />
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Text colour</span>
        <input
          type="color"
          className="mdbc-canvas-color"
          value={style.color ?? DEFAULT_TEXT_COLOR}
          onChange={(e) => onChange({ style: { ...style, color: e.target.value } })}
          aria-label="Text colour"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Background</span>
        <input
          type="color"
          className="mdbc-canvas-color"
          value={style.backgroundColor ?? DEFAULT_TEXT_BG}
          onChange={(e) => onChange({ style: { ...style, backgroundColor: e.target.value } })}
          aria-label="Background colour"
        />
      </div>
    </div>
  );
}

export { TextSection };
