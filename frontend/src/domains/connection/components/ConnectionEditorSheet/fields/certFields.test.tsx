import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CertFields } from "./certFields";
import type { ConnectionConfig } from "../../CombinedConnectionsTree/types";

function makeConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "1",
    name: "t",
    kind: "postgres",
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    isSRV: false,
    options: "",
    sslMode: "preferred",
    ...overrides,
  } as ConnectionConfig;
}

describe("CertFields", () => {
  it("renders nothing when SSL is disabled", () => {
    const { container } = render(
      <CertFields config={makeConfig({ sslMode: "disabled" })} patch={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("CA Cert")).toBeNull();
  });

  it("renders the CA/client cert/key pickers when SSL is enabled", () => {
    render(<CertFields config={makeConfig({ sslMode: "verify_ca" })} patch={vi.fn()} />);
    expect(screen.getByText("CA Cert")).toBeTruthy();
    expect(screen.getByText("Client Cert")).toBeTruthy();
    expect(screen.getByText("Client Key")).toBeTruthy();
  });

  it("patches the matching path field when an entry is typed", () => {
    const patch = vi.fn();
    render(<CertFields config={makeConfig()} patch={patch} />);
    fireEvent.change(screen.getByPlaceholderText("ca.crt"), {
      target: { value: "/etc/ssl/ca.crt" },
    });
    expect(patch).toHaveBeenCalledWith("caCertPath", "/etc/ssl/ca.crt");
    fireEvent.change(screen.getByPlaceholderText("client.key"), {
      target: { value: "/etc/ssl/client.key" },
    });
    expect(patch).toHaveBeenCalledWith("clientKeyPath", "/etc/ssl/client.key");
  });
});
