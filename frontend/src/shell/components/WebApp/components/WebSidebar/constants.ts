import { CANVASES_PATH, CONNECTIONS_PATH, HISTORY_PATH, PINNED_PATH } from "../../../../utils";
import type { SidebarLink } from "./types";

const PINNED_LABEL = "Pinned";
const CANVAS_LABEL = "Canvas";
const SIDEBAR_TEST_ID = "web-sidebar";

const SIDEBAR_LINKS: SidebarLink[] = [
  { kind: "history", label: "History", path: HISTORY_PATH },
  { kind: "pinned", label: PINNED_LABEL, path: PINNED_PATH },
  { kind: "canvases", label: CANVAS_LABEL, path: CANVASES_PATH },
  { kind: "connections", label: "Connections", path: CONNECTIONS_PATH },
];

export { CANVAS_LABEL, PINNED_LABEL, SIDEBAR_LINKS, SIDEBAR_TEST_ID };
