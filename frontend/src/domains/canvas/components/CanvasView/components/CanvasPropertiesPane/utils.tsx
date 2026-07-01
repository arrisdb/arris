import type { FC } from "react";

import type { ComponentKind } from "../../../../types";
import { ChartSection } from "./components/ChartSection";
import { QuerySection } from "./components/QuerySection";
import { ShapeSection } from "./components/ShapeSection";
import { StickySection } from "./components/StickySection";
import { TableSection } from "./components/TableSection";
import { TextSection } from "./components/TextSection";
import type { SectionProps } from "./types";

/// Every kind that has a properties section, in registry order. The single list
/// the completeness guard checks against; adding a kind means adding it here and
/// to `SECTION_FOR`.
const PROP_SECTION_KINDS: ComponentKind[] = [
  "text",
  "sticky",
  "query",
  "chart",
  "table",
  "shape",
];

/// The per-kind properties-section registry: one section component per object
/// kind. This is the same extension seam as the node-renderer registry: a new
/// kind is wired by adding one entry here (plus its common geometry is handled by
/// the always-shown `CommonSection`).
const SECTION_FOR: Record<ComponentKind, FC<SectionProps>> = {
  text: TextSection,
  sticky: StickySection,
  query: QuerySection,
  chart: ChartSection,
  table: TableSection,
  shape: ShapeSection,
};

export { PROP_SECTION_KINDS, SECTION_FOR };
