// A SQLMesh test YAML holds one test per top-level key (column 0), e.g.
// `test_dim_customers_rollup:`. Given the editor cursor offset, resolve which
// test block the cursor sits in so the toolbar can run that single test.
function sqlmeshTestNameAtCursor(text: string, cursor: number): string | null {
  const lines = text.split("\n");
  let offset = 0;
  let current: string | null = null;
  for (const line of lines) {
    if (offset > cursor) break;
    // Top-level key: starts in column 0 (no indent), not a comment/list item.
    const match = /^([^\s:#-][^:]*):/.exec(line);
    if (match) current = match[1];
    offset += line.length + 1; // +1 for the stripped "\n"
  }
  return current;
}

export { sqlmeshTestNameAtCursor };
