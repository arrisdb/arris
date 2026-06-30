import type { CanvasComponent } from "../types";

/// Trim a value to one line and a max length so the board summary stays compact
/// in the prompt (the agent needs the gist, not the full text/SQL).
function clip(value: string, max = 100): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/// Describe a single object as one id-first line the agent can reference.
function describeComponent(c: CanvasComponent): string {
  switch (c.kind) {
    case "query":
      return `- query id=${c.id} title=${JSON.stringify(c.title ?? "")} sql=${JSON.stringify(clip(c.sql))}`;
    case "chart": {
      const s = c.spec;
      const series = s.seriesColumn ? ` series=${s.seriesColumn}` : "";
      return `- chart id=${c.id} source=${c.sourceQueryId || "(unset)"} kind=${s.kind} x=${s.xColumn || "(unset)"} y=[${s.yColumns.join(",")}]${series}`;
    }
    case "table":
      return `- table id=${c.id} source=${c.sourceQueryId || "(unset)"}`;
    case "text":
      return `- text id=${c.id} ${JSON.stringify(clip(c.text))}`;
    case "sticky":
      return `- sticky id=${c.id} color=${c.color ?? "yellow"} ${JSON.stringify(clip(c.text))}`;
    case "shape":
      return `- shape id=${c.id} shape=${c.shape}${c.text ? ` ${JSON.stringify(clip(c.text))}` : ""}`;
  }
}

/// Render the current board as a compact, id-first list for the agent prompt, so
/// follow-up turns can reference, modify, or remove existing objects by id. An
/// empty board yields an empty string (the backend then says "The board is
/// empty.").
function describeBoard(components: CanvasComponent[]): string {
  if (components.length === 0) return "";
  return [...components]
    .sort((a, b) => a.z - b.z)
    .map(describeComponent)
    .join("\n");
}

export { describeBoard };
