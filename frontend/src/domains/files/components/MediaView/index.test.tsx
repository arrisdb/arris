import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

const readBase64 = vi.fn();
const openInDefault = vi.fn();

vi.mock("./ipc", () => ({
  mediaViewReadFileBase64IPC: (path: string) => readBase64(path),
  mediaViewOpenInDefaultAppIPC: (path: string) => openInDefault(path),
}));

import { MediaView } from "./index";

function tab(overrides?: Partial<EditorTab>): EditorTab {
  return {
    id: "t1",
    title: "logo.png",
    text: "",
    kind: "media",
    cursor: 0,
    tabType: "media",
    filePath: "/proj/logo.png",
    createdAt: 0,
    ...overrides,
  } as EditorTab;
}

beforeEach(() => {
  readBase64.mockReset();
  openInDefault.mockReset();
  openInDefault.mockResolvedValue(undefined);
});

describe("MediaView", () => {
  it("renders an image as a base64 data URL for previewable kinds", async () => {
    readBase64.mockResolvedValue("AAAB");
    render(<MediaView activeTab={tab()} />);
    const img = await screen.findByTestId("media-image");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAB");
    expect(readBase64).toHaveBeenCalledWith("/proj/logo.png");
  });

  it("shows an open-with-default fallback (no fetch) for unsupported media", () => {
    render(<MediaView activeTab={tab({ title: "song.mp3", filePath: "/proj/song.mp3" })} />);
    expect(screen.getByTestId("media-fallback").textContent).toContain(".mp3");
    expect(readBase64).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("media-open-default"));
    expect(openInDefault).toHaveBeenCalledWith("/proj/song.mp3");
  });

  it("falls back to open-with-default when the image fails to load", async () => {
    readBase64.mockRejectedValue(new Error("boom"));
    render(<MediaView activeTab={tab()} />);
    await waitFor(() => expect(screen.getByTestId("media-fallback")).toBeTruthy());
    fireEvent.click(screen.getByTestId("media-open-default"));
    expect(openInDefault).toHaveBeenCalledWith("/proj/logo.png");
  });

  it("shows no dimensions bar until the image reports its natural size", async () => {
    readBase64.mockResolvedValue("AAAB");
    render(<MediaView activeTab={tab()} />);
    await screen.findByTestId("media-image");
    expect(screen.queryByTestId("media-infobar")).toBeNull();
  });

  it("displays natural image dimensions in the info bar on load", async () => {
    readBase64.mockResolvedValue("AAAB");
    render(<MediaView activeTab={tab()} />);
    const img = await screen.findByTestId("media-image");
    Object.defineProperty(img, "naturalWidth", { value: 1024, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 768, configurable: true });
    fireEvent.load(img);
    const bar = await screen.findByTestId("media-infobar");
    expect(bar.textContent).toContain("1024 × 768 px");
  });
});
