// Single icon entrypoint. Wraps `lucide-react` so every chrome surface uses the
// same stroke width / size scale and we can swap libraries from one place.

import type { ComponentProps, ComponentType } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bell,
  Bot,
  BoxSelect,
  Braces,
  Brackets,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Code2,
  Columns2,
  Cog,
  Copy,
  Database,
  Hand,
  Download,
  ExternalLink,
  File as FileLucide,
  FileText,
  Filter,
  FlaskConical,
  Folder,
  GitBranch,
  GitFork,
  Hash,
  History,
  Info,
  KeyRound,
  Layers,
  Loader2,
  List,
  Mail,
  Minus,
  MousePointer2,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sprout,
  Square,
  StickyNote,
  Table as TableLucide,
  Terminal as TerminalLucide,
  Trash2,
  Type as TypeLucide,
  Unplug,
  X,
  Zap,
} from "lucide-react";

import type { SchemaNodeKind } from "@shared";
import { useSettingsStore } from "@shared/settings";

/// Reference baseline. Every explicit `size` passed by call sites is multiplied
/// by `preferences.iconSize / ICON_SIZE_BASE` so the user-facing slider scales
/// every chrome icon together.
const ICON_SIZE_BASE = 14;

type LucideIcon = ComponentType<ComponentProps<typeof X>>;

/// The Jupyter/notebook mark is a multi-color brand PNG, not a monochrome glyph.
/// It renders inside an `<svg>` (so it sizes and slots in exactly like the lucide
/// icons) via an `<image>` element pointing at the brand asset. Stroke/color are
/// ignored, as they would be for any filled mark.
const NotebookMark: LucideIcon = ({ width, height, className }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 512 512"
    className={className}
    aria-hidden
  >
    <image href="/brand/jupyter.png" width="512" height="512" />
  </svg>
);

/// Run-and-insert glyph: a play triangle with a small plus, signalling "run
/// this cell then add a new one below". Drawn here because lucide has no
/// single-glyph equivalent. Uses the same stroke conventions as lucide icons so
/// it slots in at any size.
const PlayInsert: LucideIcon = ({ width, height, strokeWidth, className }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth ?? 1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M6 4.5 L15 10 L6 15.5 Z" fill="currentColor" stroke="none" />
    <line x1="19" y1="14" x2="19" y2="21" />
    <line x1="15.5" y1="17.5" x2="22.5" y2="17.5" />
  </svg>
);

/// Named icon set the rest of the app composes against. Keeps lucide imports
/// in this one file so library swaps are contained.
const Icons = {
  arrowDown: ArrowDown,
  arrowRight: ArrowRight,
  arrowUp: ArrowUp,
  arrowUpDown: ArrowUpDown,
  barChart: BarChart3,
  bell: Bell,
  bot: Bot,
  boxSelect: BoxSelect,
  braces: Braces,
  brackets: Brackets,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  circle: Circle,
  clock: Clock,
  code: Code2,
  cog: Cog,
  columns2: Columns2,
  copy: Copy,
  database: Database,
  download: Download,
  externalLink: ExternalLink,
  file: FileLucide,
  fileText: FileText,
  filter: Filter,
  flask: FlaskConical,
  folder: Folder,
  gitBranch: GitBranch,
  gitFork: GitFork,
  hand: Hand,
  hash: Hash,
  history: History,
  info: Info,
  keyRound: KeyRound,
  layers: Layers,
  loader: Loader2,
  list: List,
  mail: Mail,
  minus: Minus,
  mousePointer: MousePointer2,
  notebook: NotebookMark,
  pencil: Pencil,
  pin: Pin,
  play: Play,
  playInsert: PlayInsert,
  plus: Plus,
  refreshCw: RefreshCw,
  rotateCcw: RotateCcw,
  search: Search,
  settings: Settings,
  sparkles: Sparkles,
  sprout: Sprout,
  square: Square,
  stickyNote: StickyNote,
  table: TableLucide,
  terminal: TerminalLucide,
  trash: Trash2,
  type: TypeLucide,
  unplug: Unplug,
  x: X,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

type IconName = keyof typeof Icons;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
  title?: string;
  /// Convenience for `aria-hidden`, defaults true since most icons are
  /// decorative and live next to a visible label.
  decorative?: boolean;
}

/// Render a Lucide icon with the app's default stroke + sizing. The passed
/// `size` (or the base 14) is scaled by the user's `preferences.iconSize`
/// slider so all chrome icons grow/shrink together. Set `decorative={false}`
/// and pass `title` for stand-alone affordances that need an accessible name.
function Icon({
  name,
  size,
  strokeWidth = 1.6,
  className,
  color,
  title,
  decorative = true,
}: IconProps) {
  const userIconSize = useSettingsStore((s) => s.iconSize);
  const baseSize = size ?? ICON_SIZE_BASE;
  const scaled = Math.max(8, Math.round(baseSize * (userIconSize / ICON_SIZE_BASE)));
  const C = Icons[name];
  return (
    <C
      width={scaled}
      height={scaled}
      strokeWidth={strokeWidth}
      className={className}
      color={color}
      aria-hidden={decorative ? true : undefined}
      aria-label={!decorative ? title : undefined}
    >
      {title ? <title>{title}</title> : null}
    </C>
  );
}

/// Lucide glyph for a file, keyed by extension / well-known filename. Shared
/// single source of truth so a file shows the same icon in the file tree, the
/// editor tab strip, and anywhere else a filename is rendered. Folders are
/// handled by the caller, not here.
function iconForFileName(name: string): IconName {
  const lower = name.toLowerCase();
  if (lower === ".gitignore" || lower.startsWith(".git")) return "gitBranch";
  const ext = lower.split(".").pop() ?? "";
  switch (ext) {
    case "sql":
      return "database";
    case "py":
      return "code";
    case "ipynb":
      return "notebook";
    case "csv":
    case "tsv":
      return "table";
    case "yml":
    case "yaml":
    case "toml":
      return "settings";
    case "json":
      return "braces";
    case "md":
    case "markdown":
      return "fileText";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx":
      return "code";
    case "sh":
    case "bash":
    case "zsh":
      return "terminal";
    case "db":
    case "sqlite":
    case "duckdb":
      return "database";
    default:
      return "file";
  }
}

/// Schema-tree icon mapping. Replaces the previous emoji map in
/// `CombinedConnectionsTree`.
function iconForSchemaKind(kind: SchemaNodeKind): IconName {
  switch (kind) {
    case "database":
      return "database";
    case "schema":
      return "folder";
    case "table":
      return "table";
    case "view":
      return "layers";
    case "materializedView":
      return "boxSelect";
    case "foreignTable":
      return "list";
    case "collection":
      return "braces";
    case "column":
      return "columns2";
    case "index":
      return "brackets";
    case "sequence":
      return "hash";
    case "function":
    case "procedure":
      return "type";
    case "trigger":
      return "zap";
    case "event":
      return "clock";
    case "type":
      return "type";
    case "key":
    case "redisStringKey":
    case "redisListKey":
    case "redisSetKey":
    case "redisHashKey":
    case "redisZsetKey":
    case "redisStreamKey":
      return "keyRound";
    case "elasticsearchIndex":
      return "table";
    case "elasticsearchAlias":
      return "gitBranch";
    case "elasticsearchIndexTemplate":
      return "fileText";
    case "elasticsearchDataStream":
      return "layers";
    case "topic":
      return "mail";
    case "group":
      return "folder";
    default:
      return "circle";
  }
}

export {
  ICON_SIZE_BASE,
  Icons,
  Icon,
  iconForFileName,
  iconForSchemaKind,
};

export type {
  LucideIcon,
  IconName,
};
