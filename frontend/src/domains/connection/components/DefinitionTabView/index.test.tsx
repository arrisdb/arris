import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { DefinitionTabView } from "./index";

const LOADING = "-- Loading definition…";
const DDL = "CREATE TABLE orders (id INTEGER);";

describe("DefinitionTabView", () => {
  beforeEach(() => {
    useTabsStore.getState().setTabs([]);
  });

  it("shows the DDL that arrives after the tab opened", () => {
    const tab = useTabsStore.getState().openObjectDefinitionTab({
      connectionId: "c1",
      object: { kind: "table", name: "orders" },
      kind: "sql",
      title: "orders (DDL)",
      text: LOADING,
    });
    const { container } = render(<DefinitionTabView activeTab={tab} />);
    expect(container.textContent).toContain(LOADING);
    act(() => useTabsStore.getState().updateTab(tab.id, { text: DDL }));
    expect(container.textContent).toContain(DDL);
  });
});
