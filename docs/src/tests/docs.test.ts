import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const DOCS_COMPONENTS_DIR = join(SRC, "components/docs");
const DOCS_PAGES_DIR = join(SRC, "pages");
const DIST = join(ROOT, "dist");

const EXPECTED_DOCS_COMPONENTS = [
  "DocsSidebar",
  "DocsTOC",
  "ArticleFooter",
  "CodeBlock",
  "Callout",
  "Steps",
  "Step",
  "DocTable",
  "NextCards",
];

const EXPECTED_DOCS_PAGES = [
  "index.html",
  "getting-started/install/index.html",
  "getting-started/first-query/index.html",
  "connections/overview/index.html",
  "connections/ssh-tunnels/index.html",
  "connections/ssl/index.html",
  "connections/secrets/index.html",
  "querying/editor/index.html",
  "querying/results/index.html",
  "querying/command-logs/index.html",
  "querying/cross-source/index.html",
  "analytics-engineering/dbt/index.html",
  "analytics-engineering/sqlmesh/index.html",
  "ai/agent/index.html",
  "reference/shortcuts/index.html",
  "reference/debug-logs/index.html",
];

beforeAll(() => {
  if (!existsSync(join(DIST, "index.html"))) {
    execSync("npx astro build", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
  }
});

describe("docs build output", () => {
  it.each(EXPECTED_DOCS_PAGES)(
    "produces %s",
    (page) => {
      expect(existsSync(join(DIST, page))).toBe(true);
    }
  );
});

describe("docs component structure", () => {
  it.each(EXPECTED_DOCS_COMPONENTS)(
    "%s has both .astro and .module.css files",
    (name) => {
      const dir = join(DOCS_COMPONENTS_DIR, name);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, `${name}.astro`))).toBe(true);
      expect(existsSync(join(dir, `${name}.module.css`))).toBe(true);
    }
  );

  it("DocsLayout exists with module.css", () => {
    expect(existsSync(join(SRC, "layouts/DocsLayout.astro"))).toBe(true);
    expect(existsSync(join(SRC, "layouts/DocsLayout.module.css"))).toBe(true);
  });

  it("docs-nav data file exists", () => {
    expect(existsSync(join(SRC, "data/docs-nav.ts"))).toBe(true);
  });
});

describe("docs no inline styles", () => {
  it("no docs component uses style= attribute", () => {
    const violations: string[] = [];
    for (const name of EXPECTED_DOCS_COMPONENTS) {
      const file = join(DOCS_COMPONENTS_DIR, name, `${name}.astro`);
      if (!existsSync(file)) continue;
      const content = readFileSync(file, "utf-8");
      if (/\sstyle="/.test(content)) {
        violations.push(name);
      }
    }
    expect(violations).toEqual([]);
  });

  it("DocsLayout has no inline styles", () => {
    const file = join(SRC, "layouts/DocsLayout.astro");
    const content = readFileSync(file, "utf-8");
    expect(content).not.toMatch(/\sstyle="/);
  });

  it("no docs page uses inline styles", () => {
    const violations: string[] = [];
    const scanDir = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanDir(join(dir, entry.name));
        } else if (entry.name.endsWith(".astro")) {
          const content = readFileSync(join(dir, entry.name), "utf-8");
          if (/\sstyle="/.test(content)) {
            violations.push(join(dir, entry.name));
          }
        }
      }
    };
    scanDir(DOCS_PAGES_DIR);
    expect(violations).toEqual([]);
  });
});

describe("docs CSS modules", () => {
  it.each(EXPECTED_DOCS_COMPONENTS)(
    "%s module.css is non-empty with at least one class",
    (name) => {
      const file = join(DOCS_COMPONENTS_DIR, name, `${name}.module.css`);
      const content = readFileSync(file, "utf-8");
      expect(content.length).toBeGreaterThan(10);
      expect(content).toMatch(/\.\w+/);
    }
  );
});

describe("docs output content", () => {
  it("connections overview has required content", () => {
    const html = readFileSync(
      join(DIST, "connections/overview/index.html"),
      "utf-8"
    );
    const required = [
      "Connections",
      "Postgres",
      "Snowflake",
      "MongoDB",
      "Federation",
      "Adding a connection",
      "Keychain",
      "Troubleshooting",
    ];
    for (const text of required) {
      expect(html).toContain(text);
    }
  });

  it("docs index links to all sections", () => {
    const html = readFileSync(
      join(DIST, "index.html"),
      "utf-8"
    );
    const sections = [
      "Getting Started",
      "Connections",
      "Querying",
      "Federation",
      "Analytics",
      "AI",
    ];
    for (const section of sections) {
      expect(html.toLowerCase()).toContain(section.toLowerCase());
    }
  });

  it("all docs pages have nav and sidebar", () => {
    for (const page of EXPECTED_DOCS_PAGES) {
      const html = readFileSync(join(DIST, page), "utf-8");
      expect(html).toContain("Arris");
      expect(html).toContain("Docs");
    }
  });

  it("shortcuts page has keyboard shortcuts", () => {
    const html = readFileSync(
      join(DIST, "reference/shortcuts/index.html"),
      "utf-8"
    );
    expect(html).toMatch(/&#8984;|⌘/);
  });

  it("federation page mentions DuckDB engine", () => {
    const html = readFileSync(
      join(DIST, "querying/cross-source/index.html"),
      "utf-8"
    );
    expect(html).toContain("DuckDB");
  });

  it("AI page mentions configurable providers", () => {
    const html = readFileSync(
      join(DIST, "ai/agent/index.html"),
      "utf-8"
    );
    expect(html.toLowerCase()).toContain("provider");
  });
});
