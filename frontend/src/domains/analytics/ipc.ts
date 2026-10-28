import { apiCall } from "@shared/api";
import {
  LINEAGE_CMD,
  MODELS_CMD,
  MODEL_CMD,
  TOOL_RUN_GET_CMD,
  TOOL_RUN_LIST_CMD,
} from "./constants";
import type {
  AnalyticsTool,
  LineageResponse,
  ModelDetail,
  ModelsResponse,
  ToolRunMeta,
  ToolRunRecord,
} from "./types";
import { currentDir } from "./utils";

function modelsIPC(tool: AnalyticsTool): Promise<ModelsResponse> {
  return apiCall(MODELS_CMD[tool], { dir: currentDir() });
}

function modelIPC(tool: AnalyticsTool, name: string): Promise<ModelDetail> {
  return apiCall(MODEL_CMD[tool], { dir: currentDir(), name });
}

/// Whole-project graph without `name`; with `column`, also the columns that feed it.
function lineageIPC(
  tool: AnalyticsTool,
  name: string | null,
  column: string | null = null,
): Promise<LineageResponse> {
  return apiCall(LINEAGE_CMD[tool], { dir: currentDir(), name, column });
}

function toolRunListIPC(tool: AnalyticsTool): Promise<ToolRunMeta[]> {
  return apiCall(TOOL_RUN_LIST_CMD, { tool });
}

function toolRunGetIPC(id: string): Promise<ToolRunRecord> {
  return apiCall(TOOL_RUN_GET_CMD, { id });
}

export { lineageIPC, modelIPC, modelsIPC, toolRunGetIPC, toolRunListIPC };
