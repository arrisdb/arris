import { describe, it, expect, beforeEach } from "vitest";
import { runNotifiedTask } from "./notifiedTask";
import { useBackgroundTasksStore } from "../hooks/backgroundTasksStore";
import { useSnackbarStore } from "../hooks/snackbarStore";

beforeEach(() => {
  useBackgroundTasksStore.setState({ tasks: new Map() });
  useSnackbarStore.setState({ snackbars: [] });
});

describe("runNotifiedTask", () => {
  it("shows the running label in background tasks while the task runs", async () => {
    let resolve!: (value: string) => void;
    const pending = runNotifiedTask("Fetch", () => new Promise((r) => { resolve = r; }));
    expect(useBackgroundTasksStore.getState().activeTasks()).toEqual([
      expect.objectContaining({ label: "Fetch…" }),
    ]);
    resolve("Already up to date");
    await pending;
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(0);
  });

  it("enqueues a success snackbar with the task message", async () => {
    const result = await runNotifiedTask("Fetch", async () => "Already up to date");
    expect(result).toEqual({ ok: true, message: "Already up to date" });
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].kind).toBe("success");
    expect(snackbars[0].message).toBe("Fetch: Already up to date");
  });

  it("enqueues an error snackbar and resolves ok=false on failure", async () => {
    const result = await runNotifiedTask("Push", async () => {
      throw new Error("rejected by remote");
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rejected by remote");
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].kind).toBe("error");
    expect(snackbars[0].message).toContain("Push: ");
  });

  it("always clears the background task, even on failure", async () => {
    await runNotifiedTask("Pull", async () => {
      throw new Error("boom");
    });
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(0);
  });

  it("runs concurrent tasks under distinct ids", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const first = runNotifiedTask("A", () => new Promise((r) => resolvers.push(r)));
    const second = runNotifiedTask("B", () => new Promise((r) => resolvers.push(r)));
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(2);
    resolvers.forEach((r) => r("done"));
    await Promise.all([first, second]);
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(0);
    expect(useSnackbarStore.getState().snackbars).toHaveLength(2);
  });
});
