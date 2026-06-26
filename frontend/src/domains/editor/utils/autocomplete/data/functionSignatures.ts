import { StateField, type Extension } from "@codemirror/state";
import { showTooltip, type Tooltip } from "@codemirror/view";
import type { DatabaseKind } from "@shared";

interface FunctionSignature {
  name: string;
  params: string[];
  returnType?: string;
}

const GENERIC_SIGNATURES: FunctionSignature[] = [
  { name: "COALESCE", params: ["value", "..."], returnType: "any" },
  { name: "NULLIF", params: ["a", "b"], returnType: "any" },
  { name: "CAST", params: ["expr AS type"], returnType: "type" },
  { name: "COUNT", params: ["expr"], returnType: "integer" },
  { name: "SUM", params: ["expr"], returnType: "numeric" },
  { name: "AVG", params: ["expr"], returnType: "numeric" },
  { name: "MIN", params: ["expr"], returnType: "any" },
  { name: "MAX", params: ["expr"], returnType: "any" },
  { name: "ROUND", params: ["n", "decimals?"], returnType: "numeric" },
  { name: "UPPER", params: ["str"], returnType: "text" },
  { name: "LOWER", params: ["str"], returnType: "text" },
  { name: "TRIM", params: ["str"], returnType: "text" },
  { name: "LENGTH", params: ["str"], returnType: "integer" },
  { name: "SUBSTRING", params: ["str", "pos", "len?"], returnType: "text" },
  { name: "REPLACE", params: ["str", "from", "to"], returnType: "text" },
  { name: "CONCAT", params: ["a", "b", "..."], returnType: "text" },
  { name: "EXTRACT", params: ["field FROM source"], returnType: "numeric" },
  { name: "ABS", params: ["n"], returnType: "numeric" },
  { name: "FLOOR", params: ["n"], returnType: "numeric" },
  { name: "CEIL", params: ["n"], returnType: "numeric" },
];

const PG_SIGNATURES: FunctionSignature[] = [
  { name: "array_agg", params: ["expr"], returnType: "array" },
  { name: "string_agg", params: ["expr", "delimiter"], returnType: "text" },
  { name: "json_agg", params: ["expr"], returnType: "json" },
  { name: "to_char", params: ["val", "format"], returnType: "text" },
  { name: "date_trunc", params: ["field", "source"], returnType: "timestamp" },
  { name: "generate_series", params: ["start", "stop", "step?"], returnType: "setof" },
  { name: "row_number", params: [], returnType: "bigint" },
  { name: "rank", params: [], returnType: "bigint" },
  { name: "dense_rank", params: [], returnType: "bigint" },
  { name: "lag", params: ["expr", "offset?", "default?"], returnType: "any" },
  { name: "lead", params: ["expr", "offset?", "default?"], returnType: "any" },
  { name: "regexp_replace", params: ["str", "pattern", "replacement"], returnType: "text" },
  { name: "unnest", params: ["array"], returnType: "setof" },
  { name: "split_part", params: ["str", "delimiter", "field"], returnType: "text" },
];

function signaturesForKind(kind?: DatabaseKind): Map<string, FunctionSignature> {
  const map = new Map<string, FunctionSignature>();
  for (const sig of GENERIC_SIGNATURES) {
    map.set(sig.name.toUpperCase(), sig);
  }
  if (kind === "postgres" || kind === "redshift") {
    for (const sig of PG_SIGNATURES) {
      map.set(sig.name.toUpperCase(), sig);
    }
  }
  return map;
}

function findFunctionCallContext(
  doc: string,
  pos: number,
): { funcName: string; paramIndex: number; parenPos: number } | null {
  let depth = 0;
  let commaCount = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = doc[i];
    if (ch === ")") depth++;
    if (ch === "(") {
      if (depth > 0) { depth--; continue; }
      const before = doc.slice(0, i).trimEnd();
      const nameMatch = before.match(/(\w+)$/);
      if (!nameMatch) return null;
      return { funcName: nameMatch[1], paramIndex: commaCount, parenPos: i };
    }
    if (ch === "," && depth === 0) commaCount++;
    if (ch === ";") return null;
  }
  return null;
}

function paramHintTooltipExtension(kind?: DatabaseKind): Extension {
  const signatures = signaturesForKind(kind);

  const tooltipField = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      const pos = tr.state.selection.main.head;
      const doc = tr.state.doc.toString();
      const ctx = findFunctionCallContext(doc, pos);
      if (!ctx) return null;
      const sig = signatures.get(ctx.funcName.toUpperCase());
      if (!sig) return null;
      return {
        pos: ctx.parenPos,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "mdbc-param-hint";
          const parts = sig.params.map((p, i) => {
            const span = document.createElement("span");
            span.textContent = p;
            if (i === ctx.paramIndex) span.className = "mdbc-param-active";
            return span;
          });
          const nameSpan = document.createElement("span");
          nameSpan.className = "mdbc-param-fname";
          nameSpan.textContent = sig.name + "(";
          dom.appendChild(nameSpan);
          parts.forEach((span, i) => {
            dom.appendChild(span);
            if (i < parts.length - 1) dom.appendChild(document.createTextNode(", "));
          });
          dom.appendChild(document.createTextNode(")"));
          if (sig.returnType) {
            const ret = document.createElement("span");
            ret.className = "mdbc-param-return";
            ret.textContent = ` → ${sig.returnType}`;
            dom.appendChild(ret);
          }
          return { dom };
        },
      };
    },
    provide: (f) => showTooltip.from(f),
  });

  return tooltipField;
}

export { paramHintTooltipExtension, findFunctionCallContext, signaturesForKind };

export type { FunctionSignature };
