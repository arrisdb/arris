import { describe, expect, it } from "vitest";
import * as shared from "./index";

describe("shared barrel", () => {
  it("re-exports the DTO value helpers from backendTypes", () => {
    expect(typeof shared.extractIpcError).toBe("function");
    expect(typeof shared.ipcErrorMessage).toBe("function");
    expect(typeof shared.coerceQueryValue).toBe("function");
  });

  it("re-exports the pane and tab-view registries", () => {
    expect(typeof shared.registerTabView).toBe("function");
    expect(typeof shared.useTabViewRegistry).toBe("function");
  });
});
