import { DEFAULT_PALETTE } from "./constants";
import type { ChartEditorOption } from "./types";

function buildColumnOptions(columns: string[]): ChartEditorOption[] {
  return [
    { value: "", label: columns.length ? "Select column..." : "Run query first" },
    ...columns.map((column) => ({ value: column, label: column })),
  ];
}

function buildZColumnOptions(
  columns: string[],
  xColumn: string,
  yColumns: string[],
): ChartEditorOption[] {
  return [
    { value: "", label: "None" },
    ...columns
      .filter((column) => column !== xColumn && !yColumns.includes(column))
      .map((column) => ({ value: column, label: column })),
  ];
}

function buildSeriesColumnOptions(
  columns: string[],
  xColumn: string,
): ChartEditorOption[] {
  return [
    { value: "", label: "None" },
    ...columns
      .filter((column) => column !== xColumn)
      .map((column) => ({ value: column, label: column })),
  ];
}

function colorAt(
  colors: string[] | undefined,
  index: number,
): string {
  return colors?.[index] ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
}

function nextColors(
  colors: string[] | undefined,
  index: number,
  color: string,
): string[] {
  const next = [...(colors ?? [])];
  while (next.length <= index) {
    next.push(DEFAULT_PALETTE[next.length % DEFAULT_PALETTE.length]);
  }
  next[index] = color;
  return next;
}

function numberOrUndefined(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

export {
  buildColumnOptions,
  buildZColumnOptions,
  buildSeriesColumnOptions,
  colorAt,
  nextColors,
  numberOrUndefined,
};
