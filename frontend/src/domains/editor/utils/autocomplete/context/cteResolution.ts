interface VirtualTable {
  name: string;
  columns: string[];
  starSources?: string[];
}

function extractSelectStarSources(body: string): string[] {
  const selectMatch = body.match(/^\s*SELECT\s+(?:DISTINCT\s+)?\*\s+FROM\s+/i);
  if (!selectMatch) return [];

  const afterFrom = body.slice(selectMatch[0].length).trim();

  const refMatch = afterFrom.match(/^\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/);
  if (refMatch) return [refMatch[1]];

  const srcMatch = afterFrom.match(
    /^\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/,
  );
  if (srcMatch) return [`${srcMatch[1]}.${srcMatch[2]}`];

  const tableMatch = afterFrom.match(/^([\w.]+)/);
  if (tableMatch) return [tableMatch[1]];

  return [];
}

function extractCteDefinitions(text: string): VirtualTable[] {
  const results: VirtualTable[] = [];
  const cteHeaderRe = /\bWITH\s+(?:RECURSIVE\s+)?/gi;
  let headerMatch: RegExpExecArray | null;

  while ((headerMatch = cteHeaderRe.exec(text)) !== null) {
    let pos = headerMatch.index + headerMatch[0].length;
    while (pos < text.length) {
      const cte = parseSingleCte(text, pos);
      if (!cte) break;
      results.push(cte.table);
      pos = cte.end;
      const afterCte = text.slice(pos).match(/^\s*,\s*/);
      if (afterCte) {
        pos += afterCte[0].length;
      } else {
        break;
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const cte of results) {
      if (cte.columns.length > 0 || !cte.starSources?.length) continue;
      for (const src of cte.starSources) {
        const srcCte = results.find((c) => c.name === src && c.columns.length > 0);
        if (srcCte) {
          cte.columns = [...srcCte.columns];
          changed = true;
          break;
        }
      }
    }
  }

  return results;
}

function parseSingleCte(
  text: string,
  startPos: number,
): { table: VirtualTable; end: number } | null {
  const rest = text.slice(startPos);
  const nameMatch = rest.match(/^(\w+)\s*/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  let pos = startPos + nameMatch[0].length;

  let explicitColumns: string[] | null = null;
  if (text[pos] === "(") {
    const closeIdx = text.indexOf(")", pos);
    if (closeIdx === -1) return null;
    const colList = text.slice(pos + 1, closeIdx);
    explicitColumns = colList
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    pos = closeIdx + 1;
  }

  const asMatch = text.slice(pos).match(/^\s*AS\s*\(\s*/i);
  if (!asMatch) return null;
  pos += asMatch[0].length;

  const bodyStart = pos;
  let depth = 1;
  while (pos < text.length && depth > 0) {
    if (text[pos] === "(") depth++;
    if (text[pos] === ")") depth--;
    pos++;
  }
  const bodyEnd = pos - 1;
  const body = text.slice(bodyStart, bodyEnd);

  const columns = explicitColumns ?? inferColumnsFromSelect(body);
  const table: VirtualTable = { name, columns };
  if (columns.length === 0 && !explicitColumns) {
    const sources = extractSelectStarSources(body);
    if (sources.length > 0) table.starSources = sources;
  }
  return { table, end: pos };
}

function inferColumnsFromSelect(body: string): string[] {
  const selectMatch = body.match(/^\s*SELECT\s+(?:DISTINCT\s+)?/i);
  if (!selectMatch) return [];

  const afterSelect = body.slice(selectMatch[0].length);
  const fromIdx = findTopLevelKeyword(afterSelect, "FROM");
  const selectList = fromIdx >= 0 ? afterSelect.slice(0, fromIdx) : afterSelect;

  const columns: string[] = [];
  for (const item of splitTopLevel(selectList)) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === "*") continue;

    const aliasMatch = trimmed.match(/\bAS\s+(\w+)\s*$/i);
    if (aliasMatch) {
      columns.push(aliasMatch[1]);
      continue;
    }

    if (/^[\w.]+$/.test(trimmed)) {
      columns.push(trimmed.split(".").pop()!);
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && /^\w+$/.test(parts[parts.length - 1])) {
      const lastWord = parts[parts.length - 1];
      if (!/^(?:FROM|WHERE|AND|OR|ON|AS|IN|IS|NOT|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END|BETWEEN|LIKE|EXISTS|ALL|ANY|DISTINCT)$/i.test(lastWord)) {
        columns.push(lastWord);
      }
    }
  }

  return columns;
}

function findTopLevelKeyword(text: string, keyword: string): number {
  const re = new RegExp(`\\b${keyword}\\b`, "gi");
  let m: RegExpExecArray | null;
  let depth = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    re.lastIndex = i;
    m = re.exec(text);
    if (m && m.index === i && depth === 0) return i;
    i++;
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function extractSubqueryAliases(text: string): VirtualTable[] {
  const results: VirtualTable[] = [];
  const re = /\bFROM\s*\(|JOIN\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    let depth = 1;
    let pos = parenStart + 1;
    while (pos < text.length && depth > 0) {
      if (text[pos] === "(") depth++;
      if (text[pos] === ")") depth--;
      pos++;
    }
    const subqueryBody = text.slice(parenStart + 1, pos - 1);
    const afterParen = text.slice(pos).match(/^\s+(?:AS\s+)?(\w+)/i);
    if (!afterParen) continue;

    const alias = afterParen[1];
    const columns = inferColumnsFromSelect(subqueryBody);
    results.push({ name: alias, columns });
  }

  return results;
}

export { extractCteDefinitions, extractSubqueryAliases, extractSelectStarSources, inferColumnsFromSelect };

export type { VirtualTable };
