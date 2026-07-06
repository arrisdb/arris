import type {
  PersistedTab,
  PlanResult,
  QueryResult,
} from "@shared";

type RecentKind = "folder" | "file";

interface RecentEntry {
  path: string;
  name: string;
  kind: RecentKind;
  openedAt: number;
  branch?: string | null;
}

interface BackgroundTask {
  id: string;
  label: string;
}

type SnackbarKind = "success" | "error";

interface Snackbar {
  id: string;
  message: string;
  kind: SnackbarKind;
}

interface NotifiedTaskResult {
  ok: boolean;
  message: string;
}

type ResultPane = "results" | "plan";

interface EditorTab extends PersistedTab {
  result?: QueryResult;
  plan?: PlanResult;
  error?: string;
  isRunning?: boolean;
  queryId?: string;
  pane?: ResultPane;
  refreshToken?: number;
  /// Current editor selection range (runtime only, never persisted). When the
  /// selection is non-empty, running the tab executes the highlighted text
  /// instead of the statement under the cursor.
  selection?: { from: number; to: number };
  /// Character range of the most recently executed statement (runtime only).
  /// Anchors the editor's run-status indicator (spinner / check / X) to the
  /// statement's first line; persists until the next run replaces it.
  runRange?: { from: number; to: number };
}

/// A leaf in the pane layout tree: one editor pane owning a subset of tabs.
/// `kind` discriminates it from a `PaneSplit` inside the `PaneNode` union.
interface PaneGroup {
  kind: "leaf";
  id: string;
  tabIds: string[];
  selectedTabId: string | null;
}

/// `row` lays children left→right, `column` lays them top→bottom.
type SplitOrientation = "row" | "column";

/// An internal node stacking ≥2 children along one axis.
interface PaneSplit {
  kind: "split";
  id: string;
  orientation: SplitOrientation;
  children: PaneNode[];
  /// Flex fractions parallel to `children`, set by dragging a separator.
  /// `undefined` (or a length mismatched with `children`) means equal sizing.
  sizes?: number[];
}

/// The recursive pane layout: either a single pane (leaf) or a split.
type PaneNode = PaneGroup | PaneSplit;

type SplitDirection = "left" | "right" | "up" | "down";

interface AppViewModel {
  activeProject: string | null;
  loading: boolean;
  bootstrapError: string | null;
  bootstrapping: boolean;
}

export type {
  AppViewModel,
  BackgroundTask,
  EditorTab,
  NotifiedTaskResult,
  Snackbar,
  SnackbarKind,
  PaneGroup,
  PaneNode,
  PaneSplit,
  RecentEntry,
  RecentKind,
  ResultPane,
  SplitDirection,
  SplitOrientation,
};
