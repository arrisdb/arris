import { describe, expect, it, vi } from "vitest";
import type { ChartSpec } from "@shared";

import { buildChartEditorViewModel } from "./utils";

const BASE: ChartSpec = { kind: "bar", xColumn: "month", yColumns: ["total"] };

function setup(spec: ChartSpec = BASE) {
  const writeSpec = vi.fn();
  const resetSpec = vi.fn();
  const vm = buildChartEditorViewModel({
    spec,
    columns: ["month", "total", "region"],
    result: undefined,
    writeSpec,
    resetSpec,
  });
  return { vm, writeSpec, resetSpec };
}

describe("buildChartEditorViewModel", () => {
  it("patches a top-level field", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeChartKind("line");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, kind: "line" });
  });

  it("patches a style field without dropping the rest of the spec", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeShowLegend(true);
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { showLegend: true } });
  });

  it("scales fill opacity from percent to a 0-1 fraction", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeFillOpacity(40);
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { fillOpacity: 0.4 } });
  });

  it("maps aggregation 'none' to undefined", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeAggregation("none");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, aggregation: undefined });
  });

  it("trims yColumns to the first measure when a series split is set", () => {
    const { vm, writeSpec } = setup({ ...BASE, yColumns: ["total", "tax"] });
    vm.onChangeSeriesColumn("region");
    expect(writeSpec).toHaveBeenCalledWith(
      expect.objectContaining({ seriesColumn: "region", yColumns: ["total"] }),
    );
  });

  it("sets a Y-axis number format, mapping 'default' back to undefined", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeYNumberFormat("compact");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yNumberFormat: "compact" } });
    vm.onChangeYNumberFormat("default");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yNumberFormat: undefined } });
  });

  it("sets an X-axis number format, mapping 'default' back to undefined", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeXNumberFormat("compact");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { xNumberFormat: "compact" } });
  });

  it("writes a Y prefix and clears it when emptied", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeYPrefix("$");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yPrefix: "$" } });
    vm.onChangeYPrefix("");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yPrefix: undefined } });
  });

  it("maps the allow-decimals toggle to false only when unchecked", () => {
    const { vm, writeSpec } = setup();
    vm.onChangeYAllowDecimals(false);
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yAllowDecimals: false } });
    vm.onChangeYAllowDecimals(true);
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { yAllowDecimals: undefined } });
  });

  it("writes a horizontal plot padding, clearing it when emptied", () => {
    const { vm, writeSpec } = setup();
    vm.onChangePlotPaddingX("40");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { plotPaddingX: 40 } });
    vm.onChangePlotPaddingX("");
    expect(writeSpec).toHaveBeenCalledWith({ ...BASE, style: { plotPaddingX: undefined } });
  });

  it("delegates reset to the supplied resetSpec", () => {
    const { vm, resetSpec } = setup();
    vm.onClickReset();
    expect(resetSpec).toHaveBeenCalled();
  });
});
