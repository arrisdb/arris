import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../ipc", () => ({
  setTransactionConfigIPC: vi.fn().mockResolvedValue(undefined),
  commitTransactionIPC: vi.fn().mockResolvedValue(undefined),
  rollbackTransactionIPC: vi.fn().mockResolvedValue(undefined),
}));

import { useTransactionStore } from "../../../../hooks/transactionStore";
import { TransactionPane } from "./index";

const CONN = "conn-1";

beforeEach(() => {
  useTransactionStore.setState({ byConnection: {} });
  vi.clearAllMocks();
});

describe("TransactionPane", () => {
  it("shows an empty hint when no statements have run", () => {
    render(<TransactionPane connectionId={CONN} onCollapse={vi.fn()} />);
    expect(screen.getByText("No statements in the current transaction.")).toBeTruthy();
    expect(screen.queryAllByTestId("txpane-item")).toHaveLength(0);
  });

  it("lists recorded statements with their rows affected", () => {
    const store = useTransactionStore.getState();
    store.recordStatement(CONN, { sql: "INSERT INTO t VALUES (1)", status: "success", rowsAffected: 1 });
    store.recordStatement(CONN, { sql: "UPDATE t SET x=2", status: "success", rowsAffected: 3 });
    render(<TransactionPane connectionId={CONN} onCollapse={vi.fn()} />);

    const items = screen.getAllByTestId("txpane-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("INSERT INTO t VALUES (1)");
    expect(items[0].textContent).toContain("1 row");
    expect(items[1].textContent).toContain("3 rows");
  });

  it("renders the error message for a failed statement", () => {
    useTransactionStore.getState().recordStatement(CONN, {
      sql: "INSERT INTO t VALUES (1)",
      status: "error",
      rowsAffected: null,
      error: "duplicate key value",
    });
    render(<TransactionPane connectionId={CONN} onCollapse={vi.fn()} />);
    expect(screen.getByText("duplicate key value")).toBeTruthy();
  });

  it("shows the statement count in the header", () => {
    useTransactionStore.getState().recordStatement(CONN, { sql: "A", status: "success", rowsAffected: null });
    useTransactionStore.getState().recordStatement(CONN, { sql: "B", status: "success", rowsAffected: null });
    render(<TransactionPane connectionId={CONN} onCollapse={vi.fn()} />);
    expect(screen.getByTestId("txpane-count").textContent).toBe("2");
  });

  it("calls onCollapse when the close button is clicked", () => {
    const onCollapse = vi.fn();
    render(<TransactionPane connectionId={CONN} onCollapse={onCollapse} />);
    fireEvent.click(screen.getByTestId("txpane-collapse-button"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
