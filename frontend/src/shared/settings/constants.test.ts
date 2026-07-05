import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  ACTION_ORDER,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  KEYMAP_PRESETS,
  PRESET_OVERRIDES,
} from "./constants";
import type { KeymapPreset } from "../backendTypes";

function presetBaseMap(preset: KeymapPreset) {
  const map = new Map<string, string | null>();
  for (const [action, def] of Object.entries(ACTIONS)) {
    map.set(action, def.defaultShortcut?.key ?? null);
  }
  const layer = (p: KeymapPreset) => {
    for (const [action, sc] of Object.entries(PRESET_OVERRIDES[p])) {
      map.set(action, sc?.key ?? null);
    }
  };
  layer("default");
  if (preset !== "default") layer(preset);
  return map;
}

describe("keymap ACTIONS", () => {
  it("binds every dbt action to a default shortcut", () => {
    expect(ACTIONS.dbtRun.defaultShortcut?.key).toBe("Mod-Shift-r");
    expect(ACTIONS.dbtTest.defaultShortcut?.key).toBe("Mod-Shift-t");
    expect(ACTIONS.dbtBuild.defaultShortcut?.key).toBe("Mod-Shift-b");
    expect(ACTIONS.dbtCompile.defaultShortcut?.key).toBe("Mod-Shift-e");
    expect(ACTIONS.dbtDocs.defaultShortcut?.key).toBe("Mod-Shift-d");
    expect(ACTIONS.dbtLineage.defaultShortcut?.key).toBe("Mod-Shift-l");
    expect(ACTIONS.dbtPreview.defaultShortcut?.key).toBe("Mod-Shift-p");
    expect(ACTIONS.dbtDiff.defaultShortcut?.key).toBe("Mod-Shift-i");
  });

  it("binds every SQLMesh action to a default shortcut", () => {
    expect(ACTIONS.sqlmeshPlan.defaultShortcut?.key).toBe("Mod-Alt-p");
    expect(ACTIONS.sqlmeshTest.defaultShortcut?.key).toBe("Mod-Alt-t");
    expect(ACTIONS.sqlmeshRender.defaultShortcut?.key).toBe("Mod-Alt-r");
    expect(ACTIONS.sqlmeshLineage.defaultShortcut?.key).toBe("Mod-Alt-g");
    expect(ACTIONS.sqlmeshPreview.defaultShortcut?.key).toBe("Mod-Alt-v");
  });

  it("gives every dbt and sqlmesh action a non-null default shortcut", () => {
    const toolActions = Object.values(ACTIONS).filter(
      (action) => action.category === "dbt" || action.category === "sqlmesh",
    );
    for (const action of toolActions) {
      expect(action.defaultShortcut).not.toBeNull();
    }
  });

  it("has no duplicate default shortcut keys across actions", () => {
    const keys = Object.values(ACTIONS)
      .map((action) => action.defaultShortcut?.key)
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("places every action in a category that is ordered and labelled", () => {
    for (const action of ACTION_ORDER) {
      const category = ACTIONS[action].category;
      expect(CATEGORY_ORDER).toContain(category);
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it("has at least one action in every ordered category", () => {
    for (const category of CATEGORY_ORDER) {
      const count = ACTION_ORDER.filter((action) => ACTIONS[action].category === category).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it("gives every action a non-empty label", () => {
    for (const action of ACTION_ORDER) {
      expect(ACTIONS[action].label.length).toBeGreaterThan(0);
    }
  });

  it("binds in-editor find & replace to Mod-f / Mod-r in the editor category", () => {
    expect(ACTIONS.findInEditor.defaultShortcut?.key).toBe("Mod-f");
    expect(ACTIONS.findInEditor.category).toBe("editor");
    expect(ACTIONS.replaceInEditor.defaultShortcut?.key).toBe("Mod-r");
    expect(ACTIONS.replaceInEditor.category).toBe("editor");
  });

  it("binds the editor context menu to Option+Enter in the editor category", () => {
    expect(ACTIONS.openEditorContextMenu.defaultShortcut?.key).toBe("Alt-Enter");
    expect(ACTIONS.openEditorContextMenu.category).toBe("editor");
  });

  it("registers the editor-surface actions so they are bindable (null default)", () => {
    const expected = [
      "expandStar",
      "pinQuery",
      "switchMongoSqlMode",
      "switchMongoShellMode",
      "switchEsSqlMode",
      "switchEsRestMode",
      "splitRight",
      "splitLeft",
      "rerunQuery",
      "showTableView",
      "showChartView",
      "toggleExecutionPlan",
      "toggleRowDetail",
      "toggleQueryText",
      "toggleFilterRow",
      "previousPage",
      "nextPage",
      "insertRow",
      "deleteRow",
      "resetEdits",
      "uploadChanges",
    ] as const;
    for (const action of expected) {
      expect(ACTION_ORDER).toContain(action);
      expect(ACTIONS[action].defaultShortcut).toBeNull();
    }
  });

  it("binds run-cell-and-insert-below to Shift-Enter", () => {
    expect(ACTIONS.runCellAndInsertBelow.defaultShortcut?.key).toBe("Shift-Enter");
  });
});

describe("preset override tables", () => {
  it("has three presets", () => {
    expect(KEYMAP_PRESETS).toEqual(["default", "vscode", "jetbrains"]);
  });

  it("only references real actions", () => {
    const valid = new Set(Object.keys(ACTIONS));
    for (const preset of KEYMAP_PRESETS) {
      for (const action of Object.keys(PRESET_OVERRIDES[preset])) {
        expect(valid.has(action)).toBe(true);
      }
    }
  });

  it("has no duplicate bindings within any preset", () => {
    for (const preset of KEYMAP_PRESETS) {
      const seen = new Map<string, string>();
      for (const [action, spec] of presetBaseMap(preset)) {
        if (spec === null) continue;
        expect(
          seen.has(spec),
          `${preset}: ${action} collides with ${seen.get(spec)} on ${spec}`,
        ).toBe(false);
        seen.set(spec, action);
      }
    }
  });

  it("applies known preset bindings", () => {
    expect(presetBaseMap("default").get("refreshSchema")).toBe("F5");
    expect(presetBaseMap("vscode").get("toggleSidebar")).toBe("Mod-b");
    expect(presetBaseMap("vscode").get("showDefinition")).toBe("F12");
    expect(presetBaseMap("vscode").get("refreshSchema")).toBe("F5");
    expect(presetBaseMap("jetbrains").get("gitCommit")).toBe("Mod-k");
    expect(presetBaseMap("jetbrains").get("aiGenerate")).toBe("Mod-Alt-k");
  });
});
