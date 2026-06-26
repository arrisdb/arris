import { describe, expect, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { inlineExportOffenders } from "./architecture";

describe("ConsoleTabView editor architecture", () => {
  it("keeps public exports in final export blocks", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    expect(inlineExportOffenders(root)).toEqual([]);
  });
});
