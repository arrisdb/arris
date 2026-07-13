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

/// Icon size for the compact segmented toggles.
const TOGGLE_ICON_SIZE = 14;

export { ALIGN_OPTIONS, STYLE_TOGGLES, TOGGLE_ICON_SIZE };
export type { TextStyleToggle };
