import { readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function srcPath(...parts: string[]): string {
  return resolve(srcRoot, ...parts);
}

// Roots that hold ComponentName/component.tsx React components. shared/ is a
// primitives library with its own naming (btn.tsx, select.tsx, ...) and is
// intentionally excluded from the component-folder filename guard.
const componentFolderRoots = [srcPath("domains"), srcPath("shell")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const entry = resolve(dir, name);
    return statSync(entry).isDirectory() ? walk(entry) : [entry];
  });
}

function walkDirs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const entry = resolve(dir, name);
    return statSync(entry).isDirectory() ? [entry, ...walkDirs(entry)] : [];
  });
}

function testSourceCandidates(testFile: string): string[] {
  const stem = testFile.replace(/\.test\.tsx?$/, "");
  const prefixStem = stem.replace(/\.[^.\/]+$/, "");
  const candidates = new Set<string>();
  for (const base of [stem, prefixStem]) {
    candidates.add(`${base}.ts`);
    candidates.add(`${base}.tsx`);
    candidates.add(`${base}.css`);
  }
  return [...candidates];
}

export { componentFolderRoots, srcRoot, srcPath, testSourceCandidates, walk, walkDirs };
