import type { DbtNode, DbtRef } from "../../components/DbtProjectPane/types";
import { fileKindForName } from "@domains/files";
import { dbtDefinitionOffset, fileNameForPath } from "./dbtReference";

// Project-aware dbt navigation: resolve a parsed jinja reference (see
// `dbtReference`) to a scanned `DbtNode`, and open its file. Owned by the dbt
// domain; the editor consumes it through the dbt barrel.

interface OpenDbtFileDeps {
  readTextFile: (path: string) => Promise<string>;
  openFileTab: (opts: { filePath: string; title: string; text: string; kind: string; cursor?: number }) => unknown;
}

// dbt node kinds whose SQL body can contain `ref(...)` calls and therefore
// support cmd+click go-to-definition (models, tests, snapshots, analyses).
const DBT_REF_SOURCE_KINDS: ReadonlySet<DbtNode["kind"]> = new Set([
  "model",
  "test",
  "snapshot",
  "analysis",
]);

function dbtNodeCanContainRefs(node: DbtNode | null | undefined): boolean {
  return node != null && DBT_REF_SOURCE_KINDS.has(node.kind);
}

function dbtModelNodeForRef(nodes: DbtNode[], refName: string): DbtNode | null {
  return nodes.find((node) => node.kind === "model" && node.name === refName) ?? null;
}

function dbtSourceNodeForRef(nodes: DbtNode[], sourceName: string, tableName: string): DbtNode | null {
  const fullName = `${sourceName}.${tableName}`;
  return nodes.find((node) => node.kind === "source" && node.name === fullName) ?? null;
}

function dbtMacroRefForName(macros: DbtRef[], name: string): DbtRef | null {
  return macros.find((macro) => macro.name === name) ?? null;
}

function dbtDocRefForName(docs: DbtRef[], name: string): DbtRef | null {
  return docs.find((doc) => doc.name === name) ?? null;
}

// Resolve a `run_results.json` node `uniqueId` (e.g.
// `test.jaffle_shop.not_null_orders_id.abc123` or `model.jaffle_shop.dim_customers`)
// back to a scanned DbtNode so a test-result row can jump to its definition.
// Falls back to matching the test name (the segments between the project and the
// trailing fingerprint) when the scanned unique_id format differs.
function dbtNodeForResult(nodes: DbtNode[], uniqueId: string): DbtNode | null {
  const exact = nodes.find((node) => node.uniqueId === uniqueId);
  if (exact) return exact;

  const parts = uniqueId.split(".");
  if (parts.length < 3) return null;
  const [resourceType] = parts;
  const candidateName =
    resourceType === "test" ? parts.slice(2, -1).join(".") : parts[parts.length - 1];
  if (!candidateName) return null;
  return nodes.find((node) => node.name === candidateName) ?? null;
}

async function openDbtFile(
  filePath: string,
  deps: OpenDbtFileDeps,
  cursorFor?: (text: string) => number | undefined,
): Promise<void> {
  if (!filePath) return;
  const text = await deps.readTextFile(filePath);
  const cursor = cursorFor?.(text);
  deps.openFileTab({
    filePath,
    title: fileNameForPath(filePath),
    text,
    kind: fileKindForName(fileNameForPath(filePath)),
    ...(cursor != null ? { cursor } : {}),
  });
}

export {
  dbtDefinitionOffset,
  dbtDocRefForName,
  dbtMacroRefForName,
  dbtModelNodeForRef,
  dbtNodeCanContainRefs,
  dbtNodeForResult,
  dbtSourceNodeForRef,
  openDbtFile,
};

export type { OpenDbtFileDeps };
