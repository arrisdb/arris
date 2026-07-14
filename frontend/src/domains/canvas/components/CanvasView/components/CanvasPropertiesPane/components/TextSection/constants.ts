import type { IconName } from "@shared/ui/Icon";

import type { TextAlign } from "../../../../../../types";

/// The four boolean run styles, each rendered as an icon toggle.
type TextStyleToggle = "bold" | "italic" | "underline" | "strike";

const STYLE_TOGGLES: { key: TextStyleToggle; icon: IconName; title: string }[] = [
  { key: "bold", icon: "bold", title: "Bold" },
  { key: "italic", icon: "italic", title: "Italic" },
  { key: "underline", icon: "underline", title: "Underline" },
  { key: "strike", icon: "strikethrough", title: "Strikethrough" },
];

const ALIGN_OPTIONS: { value: TextAlign; icon: IconName; title: string }[] = [
  { value: "left", icon: "alignLeft", title: "Align left" },
  { value: "center", icon: "alignCenter", title: "Align center" },
  { value: "right", icon: "alignRight", title: "Align right" },
];

/// Size + a slightly heavier stroke for the compact segmented toggles so the
/// letter-shaped glyphs (B/I/U/S) read crisply at small sizes.
const TOGGLE_ICON_SIZE = 15;
const TOGGLE_ICON_STROKE = 1.9;

export { ALIGN_OPTIONS, STYLE_TOGGLES, TOGGLE_ICON_SIZE, TOGGLE_ICON_STROKE };
export type { TextStyleToggle };
