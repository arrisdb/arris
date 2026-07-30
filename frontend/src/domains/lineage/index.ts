import { lazy } from "react";

// reactflow is heavy; keep it out of the startup bundle.
const LineageContainer = lazy(() =>
  import("./components/LineageContainer").then((m) => ({ default: m.LineageContainer })),
);

export { LineageContainer };
