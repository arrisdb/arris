import type { EditorTab } from "@shell/types";

interface MediaViewProps {
  activeTab: EditorTab;
}

interface ImageDimensions {
  width: number;
  height: number;
}

export type { MediaViewProps, ImageDimensions };
