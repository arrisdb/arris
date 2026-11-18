import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PROJECT_STORAGE_KEY } from "@shared/api";
import { ProjectSwitcher } from "./index";

describe("ProjectSwitcher", () => {
  const assign = vi.fn();
  beforeEach(() => {
    window.history.replaceState(null, "", "/pinned?project=%2Fwork%2Fa");
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { root: "/work/a", key: "ka" },
            { root: "/work/b", key: "kb" },
          ]),
          { status: 200 },
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it("lists projects and switching assigns new project url", async () => {
    render(<ProjectSwitcher />);
    fireEvent.click(await screen.findByText("a"));
    fireEvent.click(await screen.findByText("b"));
    expect(assign).toHaveBeenCalledWith("/?project=%2Fwork%2Fb");
    expect(window.localStorage.getItem(PROJECT_STORAGE_KEY)).toBe("/work/b");
  });

});
