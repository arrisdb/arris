// Guards the unified design-language CSS contract: tokens.css owns variables,
// split style modules expose canonical mdbc-* classes, and components use those
// classes instead of re-implementing chrome with inline styles + dead tokens.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "..", "..");
const read = (p: string) => readFileSync(resolve(sourceRoot, p), "utf8");

function sourceFiles(dir = sourceRoot): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!/\.(css|ts|tsx)$/.test(path)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(path)) return [];
    return [path];
  });
}

function cssFiles(dir = resolve(sourceRoot, "shared", "ui")): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return cssFiles(path);
    // component.css files are component-scoped (imported by their component, not
    // the global style entrypoint) and are covered by componentCssFiles().
    if (!path.endsWith(".css") || basename(path) === "index.css" || basename(path) === "component.css") return [];
    return [path];
  });
}

function componentCssFiles(dir = sourceRoot): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return componentCssFiles(path);
    // A component's colocated stylesheet is `index.css` (canonical vocabulary);
    // `component.css` is the legacy name still present in not-yet-migrated folders.
    if (basename(path) !== "index.css" && basename(path) !== "component.css") return [];
    return [path];
  });
}

function inlineStylePropViolations(): string[] {
  return sourceFiles()
    .filter((path) => path.endsWith(".tsx"))
    .flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const violations: string[] = [];

      function unwrap(expr: ts.Expression): ts.Expression {
        if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isSatisfiesExpression(expr)) {
          return unwrap(expr.expression);
        }
        return expr;
      }

      function propName(name: ts.PropertyName): string {
        if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
          return name.text;
        }
        return name.getText(sf);
      }

      function visit(node: ts.Node) {
        if (
          ts.isJsxAttribute(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "style" &&
          node.initializer &&
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          const expr = unwrap(node.initializer.expression);
          if (ts.isObjectLiteralExpression(expr)) {
            for (const prop of expr.properties) {
              if (ts.isPropertyAssignment(prop)) {
                const name = propName(prop.name);
                if (!name.startsWith("--")) {
                  const { line } = sf.getLineAndCharacterOfPosition(prop.name.getStart(sf));
                  violations.push(`${path.replace(`${sourceRoot}/`, "")}:${line + 1}: ${name}`);
                }
              } else {
                const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
                violations.push(`${path.replace(`${sourceRoot}/`, "")}:${line + 1}: ${prop.getText(sf)}`);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sf);
      return violations;
    });
}

function rawIconOnlyButtonViolations(): string[] {
  return sourceFiles()
    .filter((path) => path.endsWith(".tsx"))
    .flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const violations: string[] = [];

      function visit(node: ts.Node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          if (node.tagName.getText(sf) === "button") {
            const className = node.attributes.properties.find(
              (prop): prop is ts.JsxAttribute =>
                ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === "className",
            );
            if (className?.initializer?.getText(sf).includes("icon-only")) {
              const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
              violations.push(`${path.replace(`${sourceRoot}/`, "")}:${line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sf);
      return violations;
    });
}

const tokensCss = read("tokens.css");
const globalCss = read("global.css");
const stylesIndexCss = read("shared/ui/index.css");
const styleCssFiles = cssFiles();
const componentStyleCssFiles = componentCssFiles();
const stylesCss = styleCssFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const componentStylesCss = componentStyleCssFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const designCss = `${tokensCss}\n${stylesCss}\n${componentStylesCss}`;
const allCss = `${designCss}\n${globalCss}`;

describe("tokens.css", () => {
  it("keeps style modules out of the stale styles/css tree", () => {
    expect(existsSync(resolve(sourceRoot, "shared", "ui", "css"))).toBe(false);
  });

  it("defines the modern Tahoe-26 token set", () => {
    for (const v of [
      "--m-bg-window",
      "--m-bg-sidebar",
      "--m-bg-editor",
      "--m-fg",
      "--m-fg-3",
      "--m-accent",
      "--m-accent-2",
      "--m-sep",
      "--m-font",
      "--m-font-mono",
    ]) {
      expect(tokensCss).toContain(v);
    }
  });

  it("defines the user-tunable type-size scale (--m-fs-*)", () => {
    for (const v of [
      "--m-fs-base",
      "--m-fs-xxs",
      "--m-fs-xs",
      "--m-fs-sm",
      "--m-fs-md",
      "--m-fs-lg",
      "--m-fs-body",
    ]) {
      expect(tokensCss).toContain(v);
    }
    // Default base bumped from 13 → 14 (chrome was too small).
    expect(tokensCss).toMatch(/--m-fs-base:\s*14px/);
    // Body / chrome surfaces must derive from the scale, not literals.
    expect(allCss).toMatch(/font-size:\s*var\(--m-fs-body\)/);
    expect(stylesCss).toMatch(/font-size:\s*var\(--m-fs-md\)/);
    expect(stylesCss).toMatch(/font-size:\s*var\(--m-fs-xs\)/);
  });

  it("stays variable-only after design classes move into split modules", () => {
    expect(tokensCss).not.toMatch(/^\s*\.mdbc-/m);
    expect(tokensCss).not.toContain("@import");
  });

  it("unifies all pane surface tokens to the same opaque value (#1c1b24)", () => {
    const paneTokens = [
      "--m-bg-window",
      "--m-bg-sidebar",
      "--m-bg-titlebar",
      "--m-bg-toolbar",
      "--m-bg-surface",
      "--m-bg-editor",
    ];
    for (const token of paneTokens) {
      const re = new RegExp(`${token.replace(/[-/]/g, "\\$&")}:\\s*([^;]+);`);
      const m = tokensCss.match(re);
      expect(m, `${token} must be defined`).toBeTruthy();
      expect(m![1].trim()).toBe("#1c1b24");
    }
  });

  it("does not reference dead tokens (--m-bg-pane, --m-bg-2, --m-border, --surface-*, --text-*)", () => {
    expect(allCss).not.toMatch(/var\(--m-bg-pane/);
    expect(allCss).not.toMatch(/var\(--m-bg-2/);
    expect(allCss).not.toMatch(/var\(--m-border/);
    expect(allCss).not.toMatch(/var\(--surface-/);
    expect(allCss).not.toMatch(/var\(--text-/);
  });

  it("sidebar and pane classes do not use backdrop-filter (opaque bg)", () => {
    const sidebarBlock = stylesCss.slice(
      stylesCss.indexOf(".mdbc-sidebar {"),
      stylesCss.indexOf(".mdbc-sidebar.right")
    );
    expect(sidebarBlock).not.toContain("backdrop-filter");

    const paneBlock = stylesCss.slice(
      stylesCss.indexOf(".mdbc-pane {"),
      stylesCss.indexOf(".mdbc-pane.right")
    );
    expect(paneBlock).not.toContain("backdrop-filter");
  });

  it(".mdbc-pane has a top border for separation from window chrome", () => {
    const paneBlock = stylesCss.slice(
      stylesCss.indexOf(".mdbc-pane {"),
      stylesCss.indexOf(".mdbc-pane.right")
    );
    expect(paneBlock).toMatch(/border-top:\s*0\.5px\s+solid\s+var\(--m-sep\)/);
  });

  it(".mdbc-pane-header has compact top padding (≤8px)", () => {
    const headerBlock = stylesCss.slice(
      stylesCss.indexOf(".mdbc-pane-header {"),
      stylesCss.indexOf(".mdbc-pane-title")
    );
    const m = headerBlock.match(/padding:\s*(\d+)px/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(8);
  });

  it("styles scrollbars instead of hiding them (tabbar exempt)", () => {
    expect(designCss).toContain("scrollbar-width: thin");
    expect(designCss).toContain("::-webkit-scrollbar-thumb");
    expect(designCss).toContain("::-webkit-scrollbar-track");
    // Exempt: the tabbar tab strip and the runs chip strip. Both scroll
    // horizontally in a short fixed-height bar and must keep their content
    // vertically centered, so the space-stealing scrollbar is suppressed.
    const noneMatches = designCss.match(/scrollbar-width:\s*none/g) || [];
    expect(noneMatches.length).toBe(2);
    expect(designCss).toMatch(/\.mdbc-tabbar-tabs\s*\{[^}]*scrollbar-width:\s*none/);
    expect(designCss).toMatch(/\.mdbc-runs-track\s*\{[^}]*scrollbar-width:\s*none/);
    const hideMatches = designCss.match(/::-webkit-scrollbar\s*\{\s*display:\s*none/g) || [];
    expect(hideMatches.length).toBe(2);
    expect(designCss).toMatch(/\.mdbc-tabbar-tabs::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(designCss).toMatch(/\.mdbc-runs-track::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });

  it("keeps settings rows inset from scrollbars without a top separator", () => {
    expect(designCss).toMatch(/\.mdbc-settings-list\s*\{[^}]*padding-right:\s*12px/);
    expect(designCss).toMatch(/\.mdbc-settings-row\s*\{[^}]*border-bottom:\s*0\.5px\s+solid\s+var\(--m-sep\)/);
    expect(designCss).not.toContain(".mdbc-settings-row:first-child");
  });

  it("keeps settings resize handles invisible while covering all borders", () => {
    for (const edge of ["n", "e", "s", "w", "ne", "nw", "se", "sw"]) {
      expect(designCss).toContain(`.mdbc-sheet-resize-handle.${edge}`);
    }
    expect(designCss).not.toContain(".mdbc-sheet-resize-handle.se::after");
  });

  it("defines .mdbc-pane-body for scrollable pane content areas", () => {
    expect(stylesCss).toContain(".mdbc-pane-body");
    expect(stylesCss).toMatch(/\.mdbc-pane-body\s*\{[^}]*overflow:\s*auto/);
    expect(stylesCss).toMatch(/\.mdbc-pane-body\s*\{[^}]*flex:\s*1/);
    expect(stylesCss).toMatch(/\.mdbc-pane-body\s*\{[^}]*min-height:\s*0/);
  });

  it("exposes reusable utility classes", () => {
    for (const cls of [
      ".mdbc-pane",
      ".mdbc-pane-header",
      ".mdbc-pane-title",
      ".mdbc-section-head",
      ".mdbc-icon-btn",
      ".mdbc-empty",
      ".mdbc-link",
      ".mdbc-status-dot",
      ".mdbc-placeholder",
      ".mdbc-table",
      ".mdbc-tabbar",
      ".mdbc-tab",
      ".mdbc-runbar",
      ".mdbc-btn",
      ".mdbc-chip",
      ".mdbc-row",
      ".mdbc-status",
      ".mdbc-terminal",
      ".mdbc-topbar",
      ".mdbc-topbar-project",
      ".mdbc-topbar-branch",
      ".mdbc-branch-popover",
      ".mdbc-branch-row",
    ]) {
      expect(designCss).toContain(cls);
    }
  });

  it("uses IconButton instead of raw icon-only button markup", () => {
    expect(rawIconOnlyButtonViolations()).toEqual([]);
  });

  it("defines top bar chrome with mdbc classes and tokenized colors", () => {
    expect(designCss).toMatch(/\.mdbc-topbar\s*\{[^}]*background:\s*var\(--m-bg-window\)/);
    expect(designCss).toMatch(/\.mdbc-topbar\s*\{[^}]*border-bottom:\s*0\.5px\s+solid\s+var\(--m-sep\)/);
    expect(designCss).toMatch(/\.mdbc-topbar-project\s*\{[^}]*color:\s*var\(--m-fg\)/);
    expect(designCss).toMatch(/\.mdbc-topbar-branch\s*\{[^}]*color:\s*var\(--m-fg-2\)/);
    expect(designCss).toMatch(/\.mdbc-branch-popover\s*\{[^}]*background:\s*var\(--m-bg-surface\)/);
  });

  it("does not contain generated hashed class or variable names", () => {
    const source = sourceFiles()
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(`${allCss}\n${source}`).not.toMatch(/mdbc-(auto|dyn)-[0-9a-f]{8}|--mdbc-dyn-[0-9a-f]{8}/);
  });

  it("keeps extracted classes semantic and source-scoped", () => {
    for (const cls of [
      ".mdbc-content-root",
      ".mdbc-settings-layout",
      ".mdbc-context-menu-fixed",
      ".mdbc-editable-cell-input",
    ]) {
      expect(designCss).toContain(cls);
    }
  });
});

describe("global.css", () => {
  it("uses the modern token set, not the old --surface-/--text-/--font-sans aliases", () => {
    expect(globalCss).toContain("var(--m-font)");
    expect(globalCss).toContain("var(--m-bg-window)");
    expect(globalCss).toMatch(/font-size:\s*var\(--m-fs-body\)/);
    expect(globalCss).toMatch(/letter-spacing:\s*0;/);
    expect(globalCss).not.toMatch(/var\(--surface-/);
    expect(globalCss).not.toMatch(/var\(--text-/);
    expect(globalCss).not.toMatch(/var\(--font-sans/);
  });

  it("routes app chrome font sizes through tokens or preferences", () => {
    const violations = sourceFiles().flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return text
        .split("\n")
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) =>
          /font-size:\s*\d+(\.\d+)?px/.test(line) ||
          /fontSize\s*:\s*\d+/.test(line) ||
          /fontSize=\{\d+/.test(line)
        )
        .map(({ line, index }) => `${path.replace(`${sourceRoot}/`, "")}:${index}: ${line.trim()}`);
    });

    expect(violations).toEqual([]);
  });

  it("uses the custom Select primitive instead of native select elements", () => {
    const violations = sourceFiles()
      .filter((path) => path.endsWith(".tsx"))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        return text
          .split("\n")
          .map((line, index) => ({ line, index: index + 1 }))
          .filter(({ line }) => /<select\b|<\/select>/.test(line))
          .map(({ line, index }) => `${path.replace(`${sourceRoot}/`, "")}:${index}: ${line.trim()}`);
      });

    expect(violations).toEqual([]);
  });

  it("does not allow hardcoded CSS properties in inline style attributes", () => {
    expect(inlineStylePropViolations()).toEqual([]);
  });
});

describe("styles directory", () => {
  it("imports split CSS modules from one style entrypoint", () => {
    for (const cssFile of styleCssFiles) {
      const relativePath = cssFile.replace(`${resolve(sourceRoot, "shared", "ui")}/`, "./");
      expect(stylesIndexCss).toContain(`@import "${relativePath}";`);
    }
  });

  it("keeps split CSS modules focused instead of rebuilding one giant file", () => {
    const oversized = styleCssFiles
      .map((path) => ({
        path: path.replace(`${sourceRoot}/`, ""),
        lines: readFileSync(path, "utf8").split("\n").length,
      }))
      .filter(({ lines }) => lines > 700);
    expect(oversized).toEqual([]);
  });

  it("keeps each primitive in a PascalCase folder paired with a same-name test", () => {
    for (const name of [
      "Btn",
      "Card",
      "Chip",
      "EditableCell",
      "Field",
      "FormRow",
      "MultiSelect",
      "NumberStepper",
      "SectionHeader",
      "Select",
      "Sheet",
      "Spinner",
      "Toggle",
      "Tooltip",
    ]) {
      expect(existsSync(resolve(here, name, "index.tsx")), `${name}/index.tsx`).toBe(true);
      expect(existsSync(resolve(here, name, "index.test.tsx")), `${name}/index.test.tsx`).toBe(true);
    }
  });

  it("has no orphaned styles test files", () => {
    const tests = readdirSync(here).filter((name) => /\.test\.(ts|tsx)$/.test(name));
    const orphans = tests.filter((name) => {
      const stem = name.replace(/\.test\.tsx?$/, "");
      const prefixStem = stem.replace(/\.[^.]+$/, "");
      return ![stem, prefixStem].some((sourceName) => {
        return existsSync(join(here, `${sourceName}.ts`)) ||
          existsSync(join(here, `${sourceName}.tsx`)) ||
          existsSync(join(here, `${sourceName}.css`));
      });
    });
    expect(orphans).toEqual([]);
  });
});
