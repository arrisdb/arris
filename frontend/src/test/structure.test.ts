import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { componentFolderRoots, srcPath, srcRoot, testSourceCandidates, walk, walkDirs } from "./structure";

describe("frontend component structure", () => {
  it("organizes src by feature slice (domains/shell/shared) with no legacy roots", () => {
    expect(existsSync(srcPath("domains"))).toBe(true);
    expect(existsSync(srcPath("shell"))).toBe(true);
    expect(existsSync(srcPath("shared"))).toBe(true);
    // Layer-first roots removed by the feature-sliced restructure.
    expect(existsSync(srcPath("components"))).toBe(false);
    expect(existsSync(srcPath("app"))).toBe(false);
    expect(existsSync(srcPath("styles"))).toBe(false);
    expect(existsSync(srcPath("views"))).toBe(false);
  });

  it("fully dissolves the top-level stores/ directory (store cleanup)", () => {
    // Every Zustand store now lives with the feature that owns it: a `*Store.ts`
    // module in that owner's `hooks/` subdir (domains + shell), or the global
    // preferences store at shared/settings/store.ts. There is no layer-first
    // `src/stores` bucket any more.
    expect(existsSync(srcPath("stores"))).toBe(false);
    expect(existsSync(srcPath("shell", "utils", "keymap.ts"))).toBe(true);
    expect(existsSync(srcPath("shared", "settings", "store.ts"))).toBe(true);
  });

  it("keeps all test files paired with a source file anchor", () => {
    const testFiles = walk(srcRoot).filter(
      (file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"),
    );
    const orphans = testFiles.filter((testFile) => {
      return !testSourceCandidates(testFile).some((candidate) => existsSync(candidate));
    });

    expect(orphans).toEqual([]);
  });

  it("keeps helper exports out of store source files", () => {
    // Store modules live in a `hooks/` subdir (domains + shell): a `<name>Store.ts`
    // when a dir owns several, or a bare `store.ts` when it owns exactly one, plus
    // the global preferences store at shared/settings/store.ts. Each must export
    // ONLY its `use*Store` hook(s), no leaked types/consts/helpers.
    const storeSourceFiles = walk(srcRoot).filter((file) => {
      const name = file.split("/").pop() ?? "";
      if (name.endsWith(".test.ts")) return false;
      const isHookStore = /\/hooks\/([^/]+Store|store)\.ts$/.test(file);
      const isSettingsStore = file.endsWith("/shared/settings/store.ts");
      return isHookStore || isSettingsStore;
    });

    for (const file of storeSourceFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/^export\s+(interface|type)\s+/m);
      expect(text, file).not.toMatch(/^export\s+function\s+/m);
      expect(text, file).not.toMatch(/^export\s+const\s+/m);
      for (const match of text.matchAll(/^export\s*{\s*([^}]+)\s*};/gm)) {
        const names = match[1]
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/)[0])
          .filter(Boolean);
        expect(names.every((name) => /^use[A-Z].*Store$/.test(name)), file).toBe(true);
      }
    }
  });

  it("routes keymap actions only through the command registry (no legacy event bridge)", () => {
    // The command registry (runCommand + useRegisterCommands) is the single
    // dispatch path. The old CustomEvent bridge and the dispatch switch are
    // gone; guard against any of them creeping back in and re-splitting the
    // source of truth.
    const sources = walk(srcRoot).filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
    const forbidden = ["KEYMAP_ACTION_EVENT", "emitKeymapAction", "dispatchKeymapAction"];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(text.includes(token), `${file} references removed bridge symbol ${token}`).toBe(false);
      }
    }
  });

  it("keeps store (hooks/) barrels explicit", () => {
    // The store-only subbarrels (`<owner>/hooks/index.ts`) and shared/settings
    // must use named re-exports, never `export *`.
    const indexFiles = walk(srcRoot).filter(
      (file) => file.endsWith("/hooks/index.ts") || file.endsWith("/shared/settings/index.ts"),
    );
    for (const file of indexFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/^export\s+\*\s+from\s+/m);
    }
  });

  it("keeps sidebar child trees in their domains, not under the shell LeftSidebar", () => {
    // FileTree migrated to its domain (domains/files) in the feature-sliced restructure.
    expect(existsSync(srcPath("shell", "LeftSidebar", "FileTree"))).toBe(false);
    expect(existsSync(srcPath("domains", "files", "components"))).toBe(true);
    // GitTree migrated to its domain (domains/git) in the feature-sliced restructure.
    expect(existsSync(srcPath("shell", "LeftSidebar", "GitTree"))).toBe(false);
    expect(existsSync(srcPath("domains", "git", "components"))).toBe(true);
    expect(existsSync(srcPath("shell", "panes"))).toBe(false);
  });

  it("places every React component file at a canonical path (no ad-hoc filenames)", () => {
    // Strict structure: a .tsx file is only allowed if it is a canonical entry
    // (`index.tsx` / `index.test.tsx`), a `utils` helper (`utils.tsx` /
    // `utils.test.tsx` or a named module directly inside a `utils/` subdir), or
    // a per-entry file of a documented open registry (the connection-driver
    // `ConnectionEditorSheet/fields/<kind>.tsx`). Anything else is a concern-
    // named loose component that must move under `components/<Name>/index.tsx`.
    const canonical = new Set(["index.tsx", "index.test.tsx", "utils.tsx", "utils.test.tsx"]);
    const tsxFiles = componentFolderRoots.flatMap(walk).filter((file) => file.endsWith(".tsx"));
    const offenders = tsxFiles.filter((file) => {
      const filename = file.split("/").pop() ?? "";
      if (canonical.has(filename)) return false;
      // A named module living directly inside a `utils/` subdir (e.g. the
      // connection `utils/databaseKindIcon.tsx` icon-mapping module).
      if (/\/utils\/[^/]+\.tsx$/.test(file)) return false;
      // Documented open driver-field registry: one flat `<kind>.tsx` per kind.
      if (file.includes("/ConnectionEditorSheet/fields/")) return false;
      return true;
    });
    expect(offenders).toEqual([]);
  });

  it("keeps hooks and utils files beside their component entry", () => {
    const helperFiles = componentFolderRoots.flatMap(walk).filter(
      (file) =>
        (file.endsWith("/hooks.ts") || file.endsWith("/utils.ts")) &&
        // Module-layer files sitting directly under a root (e.g. shell/hooks.ts,
        // shell/utils.ts) are app-shell modules, not component-folder helpers.
        !componentFolderRoots.includes(dirname(file)),
    );
    for (const file of helperFiles) {
      const dir = dirname(file);
      // The component entry is always `index.tsx` (canonical vocabulary); the
      // legacy `component.tsx` name has been fully migrated out.
      expect(existsSync(resolve(dir, "index.tsx")), file).toBe(true);
    }
  });

  it("keeps component state owned by component folders, not generic state directories", () => {
    const stateDirs = componentFolderRoots.flatMap(walkDirs).filter((dir) => dir.endsWith("/state"));
    expect(stateDirs).toEqual([]);

    const stateFiles = componentFolderRoots.flatMap(walk).filter(
      (file) => file.endsWith("/states.ts") || file.endsWith("States.ts"),
    );
    expect(stateFiles).toEqual([]);
  });

  it("allows only components/, hooks/, utils/ (+ documented registry) as feature subdirectories", () => {
    // Strict structure: a feature directory's only child *directories* are
    // `components/`, `hooks/`, and `utils/` (each itself following the
    // vocabulary), plus the documented open-registry subdirs (`fields/`,
    // `drivers/`). Inside a `utils/` subtree, logic-subsystem module
    // directories may nest freely. Anything else (a concern-named folder, a
    // child component dir not grouped under `components/`) is a violation.
    const allowedSubdirs = new Set(["components", "hooks", "utils"]);
    const registrySubdirs = new Set(["fields", "drivers"]);
    const offenders: string[] = [];
    for (const root of componentFolderRoots) {
      for (const dir of walkDirs(root)) {
        // `utils/` subtrees hold named logic-subsystem modules that nest freely.
        if (dir.split("/").includes("utils")) continue;
        const base = dir.split("/").pop() ?? "";
        if (allowedSubdirs.has(base)) continue;
        if (registrySubdirs.has(base)) continue;
        // The children of a `components/` directory ARE the component dirs.
        if (dirname(dir).split("/").pop() === "components") continue;
        // A feature root sits directly under a slice root (e.g. `domains/chart`).
        if (dirname(dir) === root) continue;
        offenders.push(dir);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("creates Zustand stores only in hooks/ subdirs (or shared/settings)", () => {
    // No layer-first stores/ bucket; no loose shell store modules.
    expect(existsSync(srcPath("stores"))).toBe(false);
    expect(existsSync(srcPath("shell", "preferences.ts"))).toBe(false);
    expect(existsSync(srcPath("shell", "project.ts"))).toBe(false);
    expect(existsSync(srcPath("shell", "settings.ts"))).toBe(false);

    const sourceFiles = walk(srcRoot).filter((file) => /\.(ts|tsx)$/.test(file));
    const staleStateImports = sourceFiles.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /from ["'][^"']*\/states["']/.test(text);
    });
    expect(staleStateImports).toEqual([]);

    // Every FEATURE store (domains + shell) must live in a `hooks/` subdir owned
    // by that feature. The shared layer is exempt: it hosts the global
    // preferences store (shared/settings/store.ts) and the cross-domain
    // contribution registries (paneRegistry/tabViewRegistry), which are leaf
    // infrastructure rather than feature state.
    const storeCreators = sourceFiles
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.includes("/shared/"))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /from ["']zustand["']/.test(text) || /\bcreate<[^>]+>\(/.test(text);
      });
    const misplaced = storeCreators.filter((file) => !file.includes("/hooks/"));
    expect(misplaced).toEqual([]);
  });
});
