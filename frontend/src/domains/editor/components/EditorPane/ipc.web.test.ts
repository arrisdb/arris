import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableWebShell, setCurrentProject } from "@shared/api";
import { runQueryIPC } from "./ipc";
import { runQueryIPC as fetchResultsPageIPC } from "../../../results/components/ResultsTableView/ipc";

// The browser shell has no Tauri bridge; queries go through the arris server.
enableWebShell();

const RESULT = { columns: [], rows: [], elapsed: 1 };

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) };
}

describe("query IPC in the browser", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setCurrentProject("/work/proj");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs editor queries as history entries and unwraps the result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ run: { id: "r1" }, result: RESULT })));
    expect(await runQueryIPC("c1", "SELECT 1", [], undefined, 50, 0, "q1")).toEqual(RESULT);
    const { url, body } = lastCall(fetchMock);
    expect(url).toContain("/api/query_run");
    expect(body).toMatchObject({ connection: "c1", sql: "SELECT 1", limit: 50, queryId: "q1", source: "ui" });
  });

  it("fetches result pages without a history entry", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(RESULT)));
    expect(await fetchResultsPageIPC("c1", "SELECT 1", [], undefined, 50, 2)).toEqual(RESULT);
    const { url, body } = lastCall(fetchMock);
    expect(url).toContain("/api/query_page");
    expect(body).toMatchObject({ connection: "c1", pageSize: 50, page: 2 });
  });
});
