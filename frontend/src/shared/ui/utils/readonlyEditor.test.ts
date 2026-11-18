import { describe, expect, it } from "vitest";
import { mountReadonlyEditor } from "./readonlyEditor";

describe("mountReadonlyEditor", () => {
  it("renders the doc read-only and removes it on destroy", () => {
    const host = document.createElement("div");
    const destroy = mountReadonlyEditor({ host, doc: "SELECT 1", language: "sql", fontSize: 12 });
    expect(host.textContent).toContain("SELECT 1");
    expect(host.querySelector(".cm-content")?.getAttribute("aria-readonly")).toBe("true");
    destroy();
    expect(host.querySelector(".cm-editor")).toBeNull();
  });
});
