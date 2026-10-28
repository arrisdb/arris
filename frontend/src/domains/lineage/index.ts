import { lazy } from "react";

// reactflow is heavy; keep it out of the startup bundle.
const LineageContainer = lazy(() =>
  import("./components/LineageContainer").then((m) => ({ default: m.LineageContainer })),
);
const LineageView = lazy(() =>
  import("./components/LineageView").then((m) => ({ default: m.LineageView })),
);

export { LineageContainer, LineageView };
export type { LineageNode } from "./components/LineageView/types";
