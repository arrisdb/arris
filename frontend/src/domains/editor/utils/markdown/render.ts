type TableAlign = "left" | "right" | "center" | "none";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// Apply inline Markdown to text. Escapes first, then links (so URL contents
/// aren't touched by emphasis rules), then code/bold/italic. The `_` emphasis
/// rule is word-boundary guarded so identifiers like `foo_bar` survive.
function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label, href) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`,
  );
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  return s;
}

/// Split a GFM table row into trimmed cell strings, dropping the outer pipes.
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

/// A GFM table delimiter row: every cell is dashes with optional alignment
/// colons (e.g. `:---`, `---:`, `:--:`).
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function tableAlign(cell: string): TableAlign {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

function alignAttr(align: TableAlign): string {
  return align === "none" ? "" : ` style="text-align:${align}"`;
}

/// Render a GFM table block (header row, delimiter row, body rows) to HTML.
function renderTable(rows: string[]): string {
  const header = splitTableRow(rows[0]);
  const aligns = splitTableRow(rows[1]).map(tableAlign);
  const body = rows.slice(2).map(splitTableRow);
  const head = header
    .map((cell, i) => `<th${alignAttr(aligns[i] ?? "none")}>${inlineMarkdown(cell)}</th>`)
    .join("");
  const rowsHtml = body
    .map(
      (cells) =>
        `<tr>${header
          .map((_, i) => `<td${alignAttr(aligns[i] ?? "none")}>${inlineMarkdown(cells[i] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

/// Block-level Markdown → HTML. Supports headings, fenced code (with a language
/// class when the fence carries an info string), GFM tables, unordered/ordered
/// lists, blockquotes, horizontal rules and paragraphs with inline formatting.
/// Deliberately small: full CommonMark is out of scope.
function markdownToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length > 0) {
      html.push(`<p>${inlineMarkdown(para.join(" "))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiterRow(lines[i + 1])) {
      flushPara();
      const block = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        block.push(lines[i]);
        i += 1;
      }
      html.push(renderTable(block));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      html.push("<hr />");
      i += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s+/, ""))}</li>`);
        i += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      html.push(`<blockquote>${inlineMarkdown(quote.join(" "))}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }
    para.push(line);
    i += 1;
  }
  flushPara();
  return html.join("\n");
}

export { markdownToHtml };
