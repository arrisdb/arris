// Icon wrapper smoke + drift guard. Confirms the lucide bridge mounts every
// declared icon and that schema-kind → icon mapping returns valid names.

import { describe, expect, it, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Icon, Icons, iconForFileName, iconForSchemaKind, ICON_SIZE_BASE } from "./index";
import { useSettingsStore } from "@shared/settings";
import type { SchemaNodeKind } from "@shared";

beforeEach(() => {
  useSettingsStore.setState({ iconSize: ICON_SIZE_BASE });
});

const ALL_SCHEMA_KINDS: SchemaNodeKind[] = [
  "database",
  "schema",
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "collection",
  "column",
  "index",
  "sequence",
  "function",
  "procedure",
  "trigger",
  "event",
  "type",
  "key",
  "redisStringKey",
  "redisListKey",
  "redisSetKey",
  "redisHashKey",
  "redisZsetKey",
  "redisStreamKey",
  "elasticsearchIndex",
  "elasticsearchAlias",
  "elasticsearchIndexTemplate",
  "elasticsearchDataStream",
  "topic",
];

describe("Icon", () => {
  it("renders every named icon as an <svg>", () => {
    for (const name of Object.keys(Icons) as (keyof typeof Icons)[]) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, `expected <svg> for icon "${name}"`).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("14");
      unmount();
    }
  });

  it("honors size + strokeWidth props", () => {
    const { container } = render(<Icon name="x" size={20} strokeWidth={2} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("stroke-width")).toBe("2");
  });

  it("marks decorative icons aria-hidden by default", () => {
    const { container } = render(<Icon name="folder" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("exposes aria-label when not decorative", () => {
    const { container } = render(
      <Icon name="settings" decorative={false} title="Open settings" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("Open settings");
  });

  it("scales by preferences.iconSize", () => {
    useSettingsStore.setState({ iconSize: 21 }); // 1.5× base of 14
    const { container } = render(<Icon name="x" size={14} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("21");
  });

  it("falls back to base 14 when no size prop given", () => {
    const { container } = render(<Icon name="x" />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe(
      String(ICON_SIZE_BASE),
    );
  });

  it("clamps scaled size to a sensible minimum", () => {
    useSettingsStore.setState({ iconSize: 4 });
    const { container } = render(<Icon name="x" size={10} />);
    const w = Number(container.querySelector("svg")?.getAttribute("width"));
    expect(w).toBeGreaterThanOrEqual(8);
  });
});

describe("iconForSchemaKind", () => {
  it("returns a valid icon name for every schema kind", () => {
    for (const kind of ALL_SCHEMA_KINDS) {
      const name = iconForSchemaKind(kind);
      expect(Icons[name], `kind "${kind}" mapped to unknown icon "${name}"`).toBeDefined();
    }
  });
});

describe("iconForFileName", () => {
  it("maps known extensions to distinct lucide icons", () => {
    expect(iconForFileName("dim_users.sql")).toBe("database");
    expect(iconForFileName("utils.py")).toBe("code");
    expect(iconForFileName("raw_orders.csv")).toBe("table");
    expect(iconForFileName("config.yaml")).toBe("settings");
    expect(iconForFileName("schema.YML")).toBe("settings");
    expect(iconForFileName("manifest.json")).toBe("braces");
    expect(iconForFileName("README.md")).toBe("fileText");
    expect(iconForFileName("db.db")).toBe("database");
    expect(iconForFileName("build.sh")).toBe("terminal");
    expect(iconForFileName("analysis.ipynb")).toBe("notebook");
  });

  it("maps .gitignore and git dotfiles to the git icon", () => {
    expect(iconForFileName(".gitignore")).toBe("gitBranch");
    expect(iconForFileName(".gitattributes")).toBe("gitBranch");
  });

  it("falls back to the generic file icon for unknown extensions", () => {
    expect(iconForFileName("notes.unknownext")).toBe("file");
    expect(iconForFileName("LICENSE")).toBe("file");
  });

  it("returns an icon name that exists in the icon set", () => {
    for (const name of ["a.sql", "a.yaml", "a.py", "a.json", "a.md", "x.unknown"]) {
      expect(Icons[iconForFileName(name)]).toBeDefined();
    }
  });
});
