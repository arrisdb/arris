import { afterEach, describe, expect, it, vi } from "vitest";
import { openLicenseTab } from "./licenses";
import { useTabsStore } from "../hooks/tabsStore";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openLicenseTab", () => {
  it("fetches the Rust bundle and opens it as an in-memory markdown doc tab", async () => {
    const openDocTab = vi.fn();
    vi.spyOn(useTabsStore, "getState").mockReturnValue({ openDocTab } as never);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ text: () => Promise.resolve("RUST LICENSE TEXT") });
    vi.stubGlobal("fetch", fetchMock);

    await openLicenseTab("rust");

    expect(fetchMock).toHaveBeenCalledWith("/THIRD-PARTY-LICENSES-rust.md");
    expect(openDocTab).toHaveBeenCalledWith({
      title: "Third-Party Licenses (Rust)",
      text: "RUST LICENSE TEXT",
    });
  });

  it("fetches the JavaScript bundle and opens it as an in-memory markdown doc tab", async () => {
    const openDocTab = vi.fn();
    vi.spyOn(useTabsStore, "getState").mockReturnValue({ openDocTab } as never);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ text: () => Promise.resolve("JS LICENSE TEXT") });
    vi.stubGlobal("fetch", fetchMock);

    await openLicenseTab("javascript");

    expect(fetchMock).toHaveBeenCalledWith("/THIRD-PARTY-LICENSES-frontend.md");
    expect(openDocTab).toHaveBeenCalledWith({
      title: "Third-Party Licenses (JavaScript)",
      text: "JS LICENSE TEXT",
    });
  });
});
