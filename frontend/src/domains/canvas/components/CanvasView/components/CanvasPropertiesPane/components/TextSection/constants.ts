import type { IconName } from "@shared/ui/Icon";

import type { TextAlign } from "../../../../../../types";

/// The four boolean run styles, each rendered as an icon toggle. The id doubles
/// as the `TextStyle` field it toggles.
type TextStyleToggle = "bold" | "italic" | "underline" | "strike";

const STYLE_TOGGLES: { id: TextStyleToggle; icon: IconName; title: string }[] = [
  { id: "bold", icon: "bold", title: "Bold" },
  { id: "italic", icon: "italic", title: "Italic" },
  { id: "underline", icon: "underline", title: "Underline" },
  { id: "strike", icon: "strikethrough", title: "Strikethrough" },
];

const ALIGN_OPTIONS: { id: TextAlign; icon: IconName; title: string }[] = [
  { id: "left", icon: "alignLeft", title: "Align left" },
  { id: "center", icon: "alignCenter", title: "Align center" },
  { id: "right", icon: "alignRight", title: "Align right" },
];

/// Size + a slightly heavier stroke for the compact segmented toggles so the
/// letter-shaped glyphs (B/I/U/S) read crisply at small sizes.
const TOGGLE_ICON_SIZE = 15;
const TOGGLE_ICON_STROKE = 1.9;

export { ALIGN_OPTIONS, STYLE_TOGGLES, TOGGLE_ICON_SIZE, TOGGLE_ICON_STROKE };
