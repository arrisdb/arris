import { describe, expect, it } from "vitest";

import { formatElapsed, formatRunTimestamp } from "./utils";

describe("formatElapsed", () => {
  it("shows milliseconds below one second", () => {
    expect(formatElapsed(15)).toBe("15 ms");
  });

  it("splits into seconds and milliseconds past one second", () => {
    expect(formatElapsed(2791)).toBe("2 s 791 ms");
  });

  it("clamps negatives to zero", () => {
    expect(formatElapsed(-5)).toBe("0 ms");
  });
});

describe("formatRunTimestamp", () => {
  it("renders YYYY-MM-DD HH:MM:SS with zero padding", () => {
    // Built from local parts so the assertion is timezone-independent.
    const epoch = new Date(2026, 6, 5, 9, 5, 3).getTime();
    expect(formatRunTimestamp(epoch)).toBe("2026-07-05 09:05:03");
  });
});
