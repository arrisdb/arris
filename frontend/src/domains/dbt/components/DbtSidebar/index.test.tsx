import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDbtStore } from "../../hooks";
import { DbtSidebar } from "./index";

vi.mock("@shared/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("DbtSidebar", () => {
  beforeEach(() => {
    useDbtStore.setState({
      project: null,
      selectedNodeId: null,
    });
  });

  it("shows empty state without a project", () => {
    render(<DbtSidebar />);

    expect(screen.getByText("No dbt project open. Open a folder containing `dbt_project.yml`.")).toBeTruthy();
  });

  it("renders project sections and selects a node", () => {
    useDbtStore.setState({
      project: {
        rootPath: "/p",
        name: "demo",
        profile: "default",
        macros: [],
        docs: [],
        nodes: [
          {
            uniqueId: "model.demo.orders",
            name: "orders",
            kind: "model",
            filePath: "/p/models/orders.sql",
            dependsOn: [],
          },
        ],
      },
    });

    render(<DbtSidebar />);

    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByText("Models")).toBeTruthy();
    fireEvent.click(screen.getByText("orders"));

    expect(useDbtStore.getState().selectedNodeId).toBe("model.demo.orders");
  });
});
