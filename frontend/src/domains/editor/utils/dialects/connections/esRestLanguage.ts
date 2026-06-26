import type { StreamParser } from "@codemirror/language";

const METHOD_RE = /^(GET|POST|PUT|DELETE|HEAD|PATCH)\b/;

function findEsRestRequestAt(doc: string, pos: number): { from: number; to: number } | null {
  if (!doc.trim()) return null;
  const lines = doc.split("\n");
  const blocks: { from: number; to: number }[] = [];
  let offset = 0;
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (METHOD_RE.test(line.trimStart())) {
      if (blockStart >= 0) blocks.push({ from: blockStart, to: offset - 1 });
      blockStart = offset;
    } else if (blockStart < 0 && line.trim()) {
      blockStart = offset;
    }
    offset += line.length + 1;
  }
  if (blockStart >= 0) blocks.push({ from: blockStart, to: doc.length });
  for (const b of blocks) {
    if (pos >= b.from && pos <= b.to) return b;
  }
  return blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

interface EsRestState {
  inBody: boolean;
  inString: boolean;
}

const esRest: StreamParser<EsRestState> = {
  startState: () => ({ inBody: false, inString: false }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") stream.next();
        else if (ch === '"') { state.inString = false; return "string"; }
      }
      return "string";
    }

    if (stream.sol()) {
      if (stream.match(/^(GET|POST|PUT|DELETE|HEAD|PATCH)\b/)) {
        state.inBody = false;
        return "keyword";
      }
    }

    if (!state.inBody) {
      stream.eatSpace();
      if (stream.eol()) return null;
      if (stream.match(/^\/\S*/)) { state.inBody = true; return "atom"; }
      stream.next();
      return null;
    }

    stream.eatSpace();
    if (stream.eol()) return null;

    if (stream.match('"')) {
      state.inString = true;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") stream.next();
        else if (ch === '"') { state.inString = false; return "string"; }
      }
      return "string";
    }

    if (stream.match(/^-?\d+\.?\d*([eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^(true|false)\b/)) return "atom";
    if (stream.match(/^null\b/)) return "atom";

    const ch = stream.next();
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]") return "bracket";
    if (ch === ":" || ch === ",") return "punctuation";
    return null;
  },
};

export {
  esRest,
  findEsRestRequestAt,
};
