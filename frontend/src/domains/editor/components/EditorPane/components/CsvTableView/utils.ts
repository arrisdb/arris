import Papa from "papaparse";
import type { CsvCellEditStateStyle, CsvData, CsvTableStyle } from "./types";

function parseCsv(text: string): CsvData {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n") || text.endsWith("\r\n");

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
  });

  const data = result.data;
  if (data.length === 0) {
    return { headers: [], rows: [], lineEnding, trailingNewline };
  }

  const headers = data[0];
  const rows = data.slice(1);
  return { headers, rows, lineEnding, trailingNewline };
}

function unparseCsv(data: CsvData): string {
  const allRows = [data.headers, ...data.rows];
  const csv = Papa.unparse(allRows, { newline: data.lineEnding });
  return data.trailingNewline ? csv + data.lineEnding : csv;
}

function updateCell(
  data: CsvData,
  rowIndex: number,
  colIndex: number,
  value: string,
): CsvData {
  const rows = data.rows.map((r, i) =>
    i === rowIndex
      ? r.map((c, j) => (j === colIndex ? value : c))
      : r,
  );
  return { ...data, rows };
}

function addRow(data: CsvData): CsvData {
  const emptyRow = data.headers.map(() => "");
  return { ...data, rows: [...data.rows, emptyRow] };
}

function deleteRow(data: CsvData, rowIndex: number): CsvData {
  return { ...data, rows: data.rows.filter((_, i) => i !== rowIndex) };
}

function updateHeader(
  data: CsvData,
  colIndex: number,
  value: string,
): CsvData {
  const headers = data.headers.map((h, i) => (i === colIndex ? value : h));
  return { ...data, headers };
}

function csvTableFontSizeStyle(fontSize: number): CsvTableStyle {
  return { "--mdbc-csv-table-font-size": `${fontSize}px` };
}

function csvCellEditStateStyle(editing: boolean): CsvCellEditStateStyle {
  return {
    "--mdbc-csv-cell-cursor": editing ? "text" : "default",
    "--mdbc-csv-cell-caret-color": editing ? "auto" : "transparent",
  };
}

export {
  addRow,
  csvCellEditStateStyle,
  csvTableFontSizeStyle,
  deleteRow,
  parseCsv,
  unparseCsv,
  updateCell,
  updateHeader,
};
