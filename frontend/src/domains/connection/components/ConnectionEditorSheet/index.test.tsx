import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const testConnectionMock = vi.fn(async (_c: unknown) => {});
const saveConnectionMock = vi.fn();
// Controls the isConnected flag on the connection returned by cmd_save_connection,
// so onSaved-refresh tests can simulate saving a live vs. disconnected connection.
let saveReturnsConnected = false;
// When set, cmd_save_connection rejects with this value (mirrors a Tauri IpcError
// object reject), so error-rendering tests can drive the failure path.
let saveRejection: unknown = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === "cmd_test_connection") return testConnectionMock(args.config);
    if (command === "cmd_save_connection") {
      saveConnectionMock(args.config, args.scope);
      if (saveRejection !== null) return Promise.reject(saveRejection);
      return Promise.resolve([{ ...(args.config as object), isConnected: saveReturnsConnected }]);
    }
    if (command === "cmd_delete_connection") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  },
}));

import { ConnectionEditorSheet } from "./index";
import { useProjectStore } from "@shell/hooks/projectStore";
import { getOption, parseUri, setOption } from "./utils";

describe("getOption / setOption", () => {
  it("extracts existing key", () => {
    expect(getOption("s3_endpoint=http://minio:9000&s3_region=us-east-1", "s3_endpoint")).toBe("http://minio:9000");
  });

  it("returns empty string for missing key", () => {
    expect(getOption("s3_region=us-east-1", "s3_endpoint")).toBe("");
  });

  it("returns empty string for empty options", () => {
    expect(getOption("", "s3_endpoint")).toBe("");
  });

  it("sets a new key", () => {
    expect(setOption("", "s3_endpoint", "http://minio:9000")).toBe("s3_endpoint=http://minio:9000");
  });

  it("replaces existing key", () => {
    expect(setOption("s3_endpoint=old&s3_region=us-east-1", "s3_endpoint", "new")).toBe("s3_region=us-east-1&s3_endpoint=new");
  });

  it("removes key when value is empty", () => {
    expect(setOption("s3_endpoint=http://minio:9000&s3_region=us-east-1", "s3_endpoint", "")).toBe("s3_region=us-east-1");
  });
});

describe("parseUri scheme mapping", () => {
  it("keeps mssql kind (regression: used to fall back to postgres)", () => {
    const parsed = parseUri("mssql://sa:Test%401234@localhost/appdb");
    expect(parsed.kind).toBe("mssql");
    expect(parsed.database).toBe("appdb");
    expect(parsed.host).toBe("localhost");
    expect(parsed.user).toBe("sa");
    expect(parsed.password).toBe("Test@1234");
  });

  it("maps oracle/kafka/bigquery schemes to their own kind, not postgres", () => {
    expect(parseUri("oracle://u:p@host/db").kind).toBe("oracle");
    expect(parseUri("kafka://host:9092").kind).toBe("kafka");
    expect(parseUri("bigquery://host/ds").kind).toBe("bigquery");
  });

  it("still maps postgres aliases", () => {
    expect(parseUri("postgres://u@host/db").kind).toBe("postgres");
    expect(parseUri("postgresql://u@host/db").kind).toBe("postgres");
  });
});

describe("ConnectionEditorSheet URI field", () => {
  it("shows URI placeholder matching the kind prop", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    expect(
      screen.getByPlaceholderText("postgres://user:pass@host:port/db"),
    ).toBeTruthy();
  });

  it("shows mysql placeholder when kind is mysql", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="mysql" />);
    expect(
      screen.getByPlaceholderText("mysql://user:pass@host:port/db"),
    ).toBeTruthy();
  });

  it("renders 'Overrides settings above' hint below URI field", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    expect(screen.getByText("Overrides settings above")).toBeTruthy();
  });
});

describe("ConnectionEditorSheet SSL certificate fields", () => {
  it("shows SSL Mode and the cert pickers for a new SQL connection", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    // New connections default to sslMode "preferred", so the cert pickers show.
    expect(screen.getByText("SSL Mode")).toBeTruthy();
    expect(screen.getByText("CA Cert")).toBeTruthy();
    expect(screen.getByText("Client Cert")).toBeTruthy();
    expect(screen.getByText("Client Key")).toBeTruthy();
  });
});

describe("ConnectionEditorSheet dismissal", () => {
  it("does not close when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<ConnectionEditorSheet open={true} onClose={onClose} initial={null} kind="postgres" />);

    const sheet = screen.getByText("New connection").closest(".mdbc-popover") as HTMLElement;
    fireEvent.click(sheet.parentElement as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConnectionEditorSheet Test connection", () => {
  it("invokes testConnection and renders Connected on success", async () => {
    testConnectionMock.mockClear();
    testConnectionMock.mockResolvedValueOnce(undefined);
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    const btn = screen.getByRole("button", { name: "Test connection" });
    fireEvent.click(btn);
    await screen.findByText("Connected");
    expect(testConnectionMock).toHaveBeenCalledTimes(1);
  });

  it("renders the error message when testConnection fails", async () => {
    testConnectionMock.mockClear();
    testConnectionMock.mockRejectedValueOnce(new Error("auth failed"));
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/auth failed/);
  });

  it("shows full error text without truncation", async () => {
    const longMsg =
      "driver: connection failed: Server error: authentication failed for user 'admin' on database 'production_db'";
    testConnectionMock.mockClear();
    testConnectionMock.mockRejectedValueOnce(new Error(longMsg));
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const el = await screen.findByText(new RegExp(longMsg.slice(0, 40)));
    expect(el.textContent).toContain(longMsg);
    const style = el.style;
    expect(style.overflow).not.toBe("hidden");
    expect(style.textOverflow).not.toBe("ellipsis");
    expect(style.whiteSpace).not.toBe("nowrap");
  });
});

describe("ConnectionEditorSheet per-kind field audit", () => {
  it("sqlite shows only File and Options — no Host/Port/User/Password", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="sqlite" />);
    expect(screen.getByPlaceholderText("/absolute/folder")).toBeTruthy();
    expect(screen.queryByText("Host")).toBeNull();
    expect(screen.queryByText("Port")).toBeNull();
    expect(screen.queryByText("User")).toBeNull();
    expect(screen.queryByText("Password")).toBeNull();
    expect(screen.queryByRole("switch", { name: "SSH Tunnel" })).toBeNull();
    expect(screen.queryByText("Overrides settings above")).toBeNull();
  });

  it("duckdb shows only File and Options — no Host/Port/User/Password", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="duckdb" />);
    expect(screen.getByPlaceholderText("/absolute/folder")).toBeTruthy();
    expect(screen.queryByText("Host")).toBeNull();
    expect(screen.queryByText("Port")).toBeNull();
    expect(screen.queryByText("User")).toBeNull();
    expect(screen.queryByText("Password")).toBeNull();
  });

  it("elasticsearch shows Host/Port/User/Password/SSL Mode but no Database/URI/cert pickers", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="elasticsearch" />);
    expect(screen.getByText("Host")).toBeTruthy();
    expect(screen.getByText("Port")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.getByText("SSL Mode")).toBeTruthy();
    // Elasticsearch's driver does not load cert files, so no cert pickers.
    expect(screen.queryByText("CA Cert")).toBeNull();
    expect(screen.queryByText("Overrides settings above")).toBeNull();
    expect(screen.getByRole("switch", { name: "SSH Tunnel" })).toBeTruthy();
  });

  it("kafka shows Host/Port/User/Password/Schema Reg/SASL/SSL Mode but no Database", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="kafka" />);
    expect(screen.getByText("Host")).toBeTruthy();
    expect(screen.getByText("Port")).toBeTruthy();
    expect(screen.getByText("Schema Reg")).toBeTruthy();
    expect(screen.getByText("SASL")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.getByText("SSL Mode")).toBeTruthy();
  });

  it("mongodb shows SRV toggle", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="mongodb" />);
    expect(screen.getByRole("switch", { name: "SRV" })).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
  });

  it("mixpanel shows only Project ID/SA Username/SA Secret — no SSH/TLS/Options", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="mixpanel" />);
    expect(screen.getByPlaceholderText("Mixpanel project ID")).toBeTruthy();
    expect(screen.getByPlaceholderText("Service account username")).toBeTruthy();
    expect(screen.getByPlaceholderText("Service account secret")).toBeTruthy();
    expect(screen.queryByText("Host")).toBeNull();
    expect(screen.queryByRole("switch", { name: "SSH Tunnel" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Use TLS" })).toBeNull();
    expect(screen.queryByText("Options")).toBeNull();
  });

  it("postgres shows all standard fields including Database and SSL Mode", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    expect(screen.getByText("Host")).toBeTruthy();
    expect(screen.getByText("Port")).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    expect(screen.getByText("SSL Mode")).toBeTruthy();
    expect(screen.getByText("CA Cert")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "SSH Tunnel" })).toBeTruthy();
  });
});

describe("ConnectionEditorSheet Test connection button styling", () => {
  it("uses standard mdbc-btn styling, not the ghost variant", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    const btn = screen.getByRole("button", { name: "Test connection" });
    expect(btn.className).toContain("mdbc-btn");
    expect(btn.className).not.toContain("ghost");
  });
});

describe("ConnectionEditorSheet Cmd+Enter to Save", () => {
  it("saves when Cmd+Enter is pressed", async () => {
    saveConnectionMock.mockClear();
    const onClose = vi.fn();
    render(<ConnectionEditorSheet open={true} onClose={onClose} initial={null} kind="postgres" />);
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("saves when Ctrl+Enter is pressed", async () => {
    saveConnectionMock.mockClear();
    const onClose = vi.fn();
    render(<ConnectionEditorSheet open={true} onClose={onClose} initial={null} kind="postgres" />);
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
  });

  it("does not save on plain Enter without a modifier", () => {
    saveConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });

  it("does not leak Cmd+Enter to global window keydown listeners (no background runQuery)", async () => {
    saveConnectionMock.mockClear();
    const globalListener = vi.fn();
    window.addEventListener("keydown", globalListener);
    try {
      render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);
      fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
      await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
      // Sheet swallows the combo in capture phase, so the bubble-phase global
      // keymap listener never sees it.
      expect(globalListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", globalListener);
    }
  });

  it("swallows Cmd+Enter even when the sheet is closed-but-still-mounted does not run", () => {
    saveConnectionMock.mockClear();
    const globalListener = vi.fn();
    window.addEventListener("keydown", globalListener);
    try {
      render(<ConnectionEditorSheet open={false} onClose={() => {}} initial={null} kind="postgres" />);
      fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
      // When the sheet is not open, it must NOT swallow; the combo flows to the global listener.
      expect(globalListener).toHaveBeenCalledTimes(1);
      expect(saveConnectionMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", globalListener);
    }
  });
});

describe("ConnectionEditorSheet auto-refresh on save", () => {
  const connectedInitial = {
    id: "conn-1",
    name: "prod_mssql",
    kind: "postgres" as const,
    host: "localhost",
    port: 5432,
    database: "appdb",
    user: "sa",
    password: "secret",
    isSRV: false,
    options: "",
    sslMode: "preferred" as const,
  };

  it("calls onSaved with the saved connection when it is connected", async () => {
    saveReturnsConnected = true;
    const onSaved = vi.fn();
    render(
      <ConnectionEditorSheet
        open={true}
        onClose={() => {}}
        initial={connectedInitial}
        kind="postgres"
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: "conn-1", isConnected: true });
  });

  it("still calls onSaved when the saved connection is not connected (owner decides whether to reload)", async () => {
    saveReturnsConnected = false;
    saveConnectionMock.mockClear();
    const onSaved = vi.fn();
    render(
      <ConnectionEditorSheet
        open={true}
        onClose={() => {}}
        initial={connectedInitial}
        kind="postgres"
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: "conn-1", isConnected: false });
  });
});

describe("ConnectionEditorSheet save error rendering", () => {
  it("renders the IpcError message, not [object Object], when save fails", async () => {
    saveReturnsConnected = false;
    // Tauri rejects commands with the serialized IpcError object { code, message }.
    saveRejection = { code: "Other", message: "no project open" };
    try {
      render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="bigquery" />);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText("no project open");
      expect(screen.queryByText("[object Object]")).toBeNull();
    } finally {
      saveRejection = null;
    }
  });

  it("clears a prior 'Connected' test result when a save fails", async () => {
    saveReturnsConnected = false;
    testConnectionMock.mockClear();
    testConnectionMock.mockResolvedValueOnce(undefined);
    saveRejection = { code: "Other", message: "no project open" };
    try {
      render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="bigquery" />);
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await screen.findByText("Connected");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByText("no project open");
      // The stale success indicator must not coexist with the failure.
      expect(screen.queryByText("Connected")).toBeNull();
    } finally {
      saveRejection = null;
    }
  });
});

describe("ConnectionEditorSheet SSH toggle", () => {
  const sshInitial = {
    id: "conn-ssh",
    name: "prod_postgres",
    kind: "postgres" as const,
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "",
    isSRV: false,
    options: "",
    sslMode: "preferred" as const,
    sshHost: "bastion.example.com",
    sshPort: 22,
    sshUser: "ec2-user",
    sshPassword: "secret",
    sshPrivateKey: "~/.ssh/id_rsa",
  };

  it("opens with the SSH toggle on when the initial config has an ssh host", () => {
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={sshInitial} kind="postgres" />);
    expect(screen.getByRole("switch", { name: "SSH Tunnel" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("SSH Host")).toBeTruthy();
  });

  it("clears all ssh* config fields when the SSH toggle is turned off", async () => {
    saveConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={sshInitial} kind="postgres" />);

    // Turn the tunnel off, then the SSH fields must disappear.
    fireEvent.click(screen.getByRole("switch", { name: "SSH Tunnel" }));
    expect(screen.queryByText("SSH Host")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
    const savedConfig = saveConnectionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(savedConfig.sshHost).toBeUndefined();
    expect(savedConfig.sshPort).toBeUndefined();
    expect(savedConfig.sshUser).toBeUndefined();
    expect(savedConfig.sshPassword).toBeUndefined();
    expect(savedConfig.sshPrivateKey).toBeUndefined();
  });

  it("blocks Test connection and shows an error when SSH is on but the host is empty", async () => {
    testConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);

    // Turn SSH on without filling the host.
    fireEvent.click(screen.getByRole("switch", { name: "SSH Tunnel" }));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await screen.findByText("SSH tunnel requires a host");
    expect(screen.queryByText("Connected")).toBeNull();
    expect(testConnectionMock).not.toHaveBeenCalled();
  });

  it("blocks Save and shows an error when SSH is on but the host is empty", async () => {
    saveConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="postgres" />);

    fireEvent.click(screen.getByRole("switch", { name: "SSH Tunnel" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("SSH tunnel requires a host");
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });
});

describe("ConnectionEditorSheet save scope", () => {
  it("saves globally when no project is open (local would have nowhere to persist)", async () => {
    useProjectStore.setState({ activeProjectPath: null });
    saveConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="bigquery" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
    expect(saveConnectionMock.mock.calls[0][1]).toBe("global");
  });

  it("saves locally when a project is open", async () => {
    useProjectStore.setState({ activeProjectPath: "/tmp/proj" });
    saveConnectionMock.mockClear();
    try {
      render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="bigquery" />);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
      expect(saveConnectionMock.mock.calls[0][1]).toBe("local");
    } finally {
      useProjectStore.setState({ activeProjectPath: null });
    }
  });
});

describe("ConnectionEditorSheet bigquery location field", () => {
  it("persists the BigQuery Location into the saved config", async () => {
    saveConnectionMock.mockClear();
    render(<ConnectionEditorSheet open={true} onClose={() => {}} initial={null} kind="bigquery" />);

    fireEvent.change(screen.getByPlaceholderText("US, EU, asia-northeast1"), {
      target: { value: "EU" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveConnectionMock).toHaveBeenCalledTimes(1));
    const savedConfig = saveConnectionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(savedConfig.location).toBe("EU");
  });
});
