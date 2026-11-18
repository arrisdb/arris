import type { AnalyticsSection, AnalyticsTool } from "../../types";

interface AnalyticsNavProps {
  tool: AnalyticsTool;
  section: AnalyticsSection;
  onSelect: (section: AnalyticsSection) => void;
}

export type { AnalyticsNavProps };
