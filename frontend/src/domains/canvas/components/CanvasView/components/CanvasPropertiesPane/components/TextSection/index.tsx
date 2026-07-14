import { Icon } from "@shared/ui/Icon";
import { ColorField } from "@shared/ui/ColorField";

import { DEFAULT_TEXT_BG, DEFAULT_TEXT_COLOR } from "../../constants";
import type { SectionProps } from "../../types";
import { ALIGN_OPTIONS, STYLE_TOGGLES, TOGGLE_ICON_SIZE, TOGGLE_ICON_STROKE } from "./constants";

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
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Style</span>
        <div className="mdbc-segmented mdbc-segmented-compact mdbc-segmented-icon">
          {STYLE_TOGGLES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={style[t.key] ? "active" : ""}
              title={t.title}
              aria-label={t.title}
              aria-pressed={!!style[t.key]}
              onClick={() => onChange({ style: { ...style, [t.key]: !style[t.key] } })}
            >
              <Icon name={t.icon} size={TOGGLE_ICON_SIZE} strokeWidth={TOGGLE_ICON_STROKE} />
            </button>
          ))}
        </div>
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Align</span>
        <div className="mdbc-segmented mdbc-segmented-compact mdbc-segmented-icon">
          {ALIGN_OPTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={align === a.value ? "active" : ""}
              title={a.title}
              aria-label={a.title}
              aria-pressed={align === a.value}
              onClick={() => onChange({ style: { ...style, align: a.value } })}
            >
              <Icon name={a.icon} size={TOGGLE_ICON_SIZE} />
            </button>
          ))}
        </div>
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Text colour</span>
        <ColorField
          label="Text colour"
          value={style.color}
          defaultColor={DEFAULT_TEXT_COLOR}
          onChange={(color) => onChange({ style: { ...style, color } })}
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Background</span>
        <ColorField
          label="Background colour"
          value={style.backgroundColor}
          defaultColor={DEFAULT_TEXT_BG}
          allowNone
          onChange={(backgroundColor) => onChange({ style: { ...style, backgroundColor } })}
        />
      </div>
    </div>
  );
}

export { TextSection };
