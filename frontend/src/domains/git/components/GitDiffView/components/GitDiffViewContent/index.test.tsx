import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffFileSection } from "./index";
import type { DiffHunk } from "../../types";

describe("DiffFileSection", () => {
  it("shows a non-previewable message when there are no hunks (binary file)", () => {
    render(
      <DiffFileSection
        diff={{ path: "/repo/marketing/audio/part3/para1.mp3", hunks: [], collapsed: false }}
        repoRoot="/repo"
        onToggleCollapse={() => {}}
      />,
    );

    expect(screen.getByTestId("diff-no-preview-para1.mp3").textContent).toBe(
      "Cannot preview this file type",
    );
    // No diff table is rendered for a non-previewable file.
    expect(document.querySelector(".git-diff-table")).toBeNull();
  });

  it("renders the diff table (not the message) for a text file with hunks", () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        lines: [{ kind: "ctx", text: "hello" }],
      },
    ];
    render(
      <DiffFileSection
        diff={{ path: "/repo/models/a.sql", hunks, collapsed: false }}
        repoRoot="/repo"
        onToggleCollapse={() => {}}
      />,
    );

    expect(document.querySelector(".git-diff-table")).toBeTruthy();
    expect(screen.queryByTestId("diff-no-preview-a.sql")).toBeNull();
  });

  it("hides the message when the file section is collapsed", () => {
    render(
      <DiffFileSection
        diff={{ path: "/repo/audio.mp3", hunks: [], collapsed: true }}
        repoRoot="/repo"
        onToggleCollapse={() => {}}
      />,
    );

    expect(screen.queryByTestId("diff-no-preview-audio.mp3")).toBeNull();
  });
});
