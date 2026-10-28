import type { WebRoute } from "../../utils";

const CONNECTIONS_CHANGED_EVENT = "connections_changed";
const NO_PROJECT_MESSAGE = "Run /arris in a project folder, or pick a project above.";
const WEB_APP_TEST_ID = "web-app";
// Routes whose page fills the viewport instead of the reading column.
const WIDE_ROUTES = new Set<WebRoute["kind"]>(["canvas", "lineage"]);

export {
  CONNECTIONS_CHANGED_EVENT,
  NO_PROJECT_MESSAGE,
  WEB_APP_TEST_ID,
  WIDE_ROUTES,
};
