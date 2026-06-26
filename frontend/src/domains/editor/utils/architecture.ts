import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const INLINE_EXPORT_PATTERN =
  /^export\s+(?:interface|type\s+[A-Za-z_$]|abstract\s+class|class|function|async\s+function|const|let|var)\b/m;

function editorSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return editorSourceFiles(path);
    if (!entry.isFile() || !path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    return [path];
  });
}

function inlineExportOffenders(root: string): string[] {
  return editorSourceFiles(root)
    .filter((path) => INLINE_EXPORT_PATTERN.test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path));
}

export { inlineExportOffenders };
