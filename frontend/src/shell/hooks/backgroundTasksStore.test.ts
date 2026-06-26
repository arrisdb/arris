import { describe, it, expect, beforeEach } from "vitest";
import { useBackgroundTasksStore } from ".";

beforeEach(() => {
  useBackgroundTasksStore.setState({ tasks: new Map() });
});

describe("useBackgroundTasksStore", () => {
  it("starts a task", () => {
    useBackgroundTasksStore.getState().startTask("t1", "Loading dbt…");
    expect(useBackgroundTasksStore.getState().tasks.get("t1")).toBe("Loading dbt…");
  });

  it("ends a task", () => {
    useBackgroundTasksStore.getState().startTask("t1", "Loading");
    useBackgroundTasksStore.getState().endTask("t1");
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(0);
  });

  it("manages multiple tasks", () => {
    const { startTask } = useBackgroundTasksStore.getState();
    startTask("a", "Task A");
    startTask("b", "Task B");
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(2);
    useBackgroundTasksStore.getState().endTask("a");
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(1);
    expect(useBackgroundTasksStore.getState().tasks.get("b")).toBe("Task B");
  });

  it("activeTasks returns all tasks", () => {
    const { startTask } = useBackgroundTasksStore.getState();
    startTask("x", "X label");
    startTask("y", "Y label");
    const tasks = useBackgroundTasksStore.getState().activeTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks).toContainEqual({ id: "x", label: "X label" });
    expect(tasks).toContainEqual({ id: "y", label: "Y label" });
  });

  it("ending nonexistent task is no-op", () => {
    useBackgroundTasksStore.getState().endTask("nope");
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(0);
  });

  it("overwriting existing task updates label", () => {
    useBackgroundTasksStore.getState().startTask("t1", "Old");
    useBackgroundTasksStore.getState().startTask("t1", "New");
    expect(useBackgroundTasksStore.getState().tasks.get("t1")).toBe("New");
    expect(useBackgroundTasksStore.getState().tasks.size).toBe(1);
  });
});
