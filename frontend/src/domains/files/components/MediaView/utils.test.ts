import { describe, expect, it } from "vitest";
import { isImageFileName, isMediaFileName, mimeForImageName, imageDataUrl } from "./utils";

describe("isImageFileName", () => {
  it("is true for previewable image extensions", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.ico"]) {
      expect(isImageFileName(name)).toBe(true);
    }
  });

  it("is false for non-image files", () => {
    for (const name of ["song.mp3", "clip.mp4", "notes.txt", "q.sql", "doc.pdf"]) {
      expect(isImageFileName(name)).toBe(false);
    }
  });
});

describe("isMediaFileName", () => {
  it("is true for images and non-previewable media", () => {
    for (const name of ["a.png", "song.mp3", "clip.mp4", "v.mov", "doc.pdf", "s.webm"]) {
      expect(isMediaFileName(name)).toBe(true);
    }
  });

  it("is false for plain text/code files", () => {
    for (const name of ["notes.txt", "q.sql", "data.json", "conf.yaml"]) {
      expect(isMediaFileName(name)).toBe(false);
    }
  });
});

describe("mimeForImageName", () => {
  it("maps known image extensions to their MIME type", () => {
    expect(mimeForImageName("a.png")).toBe("image/png");
    expect(mimeForImageName("b.jpg")).toBe("image/jpeg");
    expect(mimeForImageName("c.svg")).toBe("image/svg+xml");
  });
});

describe("imageDataUrl", () => {
  it("builds a base64 data URL with the right MIME type", () => {
    expect(imageDataUrl("logo.png", "AAAB")).toBe("data:image/png;base64,AAAB");
  });
});
