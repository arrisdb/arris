import type { CanvasComponent } from "../../../../types";

/// Props every properties section receives. The section narrows `component` to
/// its own kind (the registry guarantees the match) and writes edits through
/// `onChange`, which merges a patch into the selected object.
interface SectionProps {
  tabId: string;
  component: CanvasComponent;
  onChange: (patch: Partial<CanvasComponent>) => void;
}

interface CanvasPropertiesPaneProps {
  tabId: string;
  component: CanvasComponent;
  onChange: (patch: Partial<CanvasComponent>) => void;
}

export type { CanvasPropertiesPaneProps, SectionProps };
