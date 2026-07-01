import { DEFAULT_TEXT_COLOR } from "../../constants";
import type { TextAlign } from "../../../../../../types";
import type { SectionProps } from "../../types";

const ALIGNS: TextAlign[] = ["left", "center", "right"];
const ALIGN_LABEL: Record<TextAlign, string> = { left: "L", center: "C", right: "R" };

/// Text-specific controls: font size, bold toggle, alignment, and colour. All
/// write into the object's `style`, which the TextNode renderer consumes. Each
/// control sits in a label-left row.
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
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Align</span>
        <div className="mdbc-segmented mdbc-segmented-compact">
          <button
            type="button"
            className={style.bold ? "active" : ""}
            title="Bold"
            onClick={() => onChange({ style: { ...style, bold: !style.bold } })}
          >
            B
          </button>
          {ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              className={align === a ? "active" : ""}
              title={`Align ${a}`}
              onClick={() => onChange({ style: { ...style, align: a } })}
            >
              {ALIGN_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Colour</span>
        <input
          type="color"
          className="mdbc-canvas-color"
          value={style.color ?? DEFAULT_TEXT_COLOR}
          onChange={(e) => onChange({ style: { ...style, color: e.target.value } })}
          aria-label="Colour"
        />
      </div>
    </div>
  );
}

export { TextSection };
