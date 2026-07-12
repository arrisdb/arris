import { describe, expect, it } from "vitest";

import type { QueryValue } from "@shared";

import { cellText, pageRangeLabel } from "./utils";

describe("cellText", () => {
  it("renders values and NULLs", () => {
    expect(cellText({ kind: "int", value: 7 } as unknown as QueryValue)).toBe("7");
    expect(cellText({ kind: "null", value: null } as unknown as QueryValue)).toBe("NULL");
  });
});

describe("pageRangeLabel", () => {
  it("labels a page against the known total", () => {
    expect(pageRangeLabel(0, 200, 10000000)).toBe("1-200 of 10,000,000");
    expect(pageRangeLabel(200, 200, 500)).toBe("201-400 of 500");
  });

  it("labels an empty result", () => {
    expect(pageRangeLabel(0, 0, 0)).toBe("0 of 0");
  });

  it("shows an unknown total while the source is still streaming", () => {
    expect(pageRangeLabel(0, 200, undefined)).toBe("1-200 of …");
  });
});
