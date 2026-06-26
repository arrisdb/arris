// Pure `;`-delimited statement splitting, free of any CodeMirror runtime so it
// can be imported by plain logic (e.g. the run-query resolver) without dragging
// editor extensions into non-editor bundles. The decoration extension in
// `statementHighlight.ts` reuses `findStatementAt` from here.

interface StmtRange {
  from: number;
  to: number;
}

function findStatementAt(doc: string, pos: number): StmtRange | null {
  if (!doc.trim()) return null;

  let inSQ = false;
  let inDQ = false;
  let inLC = false;
  let inBC = false;

  const stmts: { from: number; to: number }[] = [];
  let start = 0;

  for (let i = 0; i < doc.length; i++) {
    const ch = doc[i];
    const nx = doc[i + 1];

    if (inLC) {
      if (ch === "\n") inLC = false;
      continue;
    }
    if (inBC) {
      if (ch === "*" && nx === "/") {
        inBC = false;
        i++;
      }
      continue;
    }
    if (inSQ) {
      if (ch === "'" && nx === "'") {
        i++;
        continue;
      }
      if (ch === "'") inSQ = false;
      continue;
    }
    if (inDQ) {
      if (ch === '"' && nx === '"') {
        i++;
        continue;
      }
      if (ch === '"') inDQ = false;
      continue;
    }

    if (ch === "-" && nx === "-") {
      inLC = true;
      i++;
      continue;
    }
    if (ch === "/" && nx === "*") {
      inBC = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSQ = true;
      continue;
    }
    if (ch === '"') {
      inDQ = true;
      continue;
    }

    if (ch === ";") {
      stmts.push({ from: start, to: i + 1 });
      start = i + 1;
    }
  }

  if (start < doc.length) {
    stmts.push({ from: start, to: doc.length });
  }

  for (const stmt of stmts) {
    if (pos < stmt.from || pos > stmt.to) continue;

    let f = stmt.from;
    let t = stmt.to;
    while (f < t && /\s/.test(doc[f])) f++;
    while (t > f && /\s/.test(doc[t - 1])) t--;
    if (f >= t) return null;

    return { from: f, to: t };
  }

  return null;
}

// Single-line statement boundary, trimmed. Used by line-delimited consoles like
// the Redis CLI where each command occupies its own line (no `;` separators), so
// a run executes just the command under the cursor.
function findLineAt(doc: string, pos: number): StmtRange | null {
  if (!doc.trim()) return null;
  const clamped = Math.max(0, Math.min(pos, doc.length));
  let from = doc.lastIndexOf("\n", clamped - 1) + 1;
  let to = doc.indexOf("\n", clamped);
  if (to === -1) to = doc.length;
  while (from < to && /\s/.test(doc[from])) from++;
  while (to > from && /\s/.test(doc[to - 1])) to--;
  if (from >= to) return null;
  return { from, to };
}

export type { StmtRange };
export { findLineAt, findStatementAt };
