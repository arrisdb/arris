import type { Completion, CompletionContext } from "@codemirror/autocomplete";

import { CompletionProvider, type CompletionAnalysis } from "../core/provider";
import { resolveSchemaPath, yamlPathAtCursor } from "./dbtYaml";
import type { YamlSchemaNode } from "./dbtYaml";

type SqlMeshYamlFileType = "config" | "test";

const CONNECTION_NODE: YamlSchemaNode = {
  keys: {
    type: null,
    host: null,
    port: null,
    user: null,
    password: null,
    database: null,
    catalog: null,
    schema: null,
    role: null,
    warehouse: null,
    account: null,
    concurrent_tasks: null,
    register_comments: null,
    pre_ping: null,
    keepalive: null,
    connect_timeout: null,
    ssl: null,
    sslmode: null,
    check_import: null,
  },
};

const GATEWAY_NODE: YamlSchemaNode = {
  keys: {
    connection: CONNECTION_NODE,
    state_connection: CONNECTION_NODE,
    test_connection: CONNECTION_NODE,
    state_schema: null,
    scheduler: { keys: { type: null } },
    variables: null,
  },
};

const MODEL_DEFAULTS_NODE: YamlSchemaNode = {
  keys: {
    dialect: null,
    start: null,
    cron: null,
    owner: null,
    storage_format: null,
    table_format: null,
    interval_unit: null,
    catalog: null,
    schema: null,
    grain: null,
    allow_partials: null,
    enabled: null,
    optimize_query: null,
    session_properties: null,
    physical_properties: null,
    virtual_properties: null,
  },
};

const PLAN_NODE: YamlSchemaNode = {
  keys: {
    auto_categorize_changes: null,
    include_unmodified: null,
    forward_only: null,
    enable_preview: null,
    no_diff: null,
    no_prompts: null,
    auto_apply: null,
    use_finalized_state: null,
  },
};

const FORMAT_NODE: YamlSchemaNode = {
  keys: {
    normalize: null,
    pad: null,
    indent: null,
    normalize_functions: null,
    leading_comma: null,
    max_text_width: null,
    append_newline: null,
    no_rewrite_casts: null,
  },
};

const LINTER_NODE: YamlSchemaNode = {
  keys: {
    enabled: null,
    rules: null,
    warn_rules: null,
    ignored_rules: null,
  },
};

const CONFIG_SCHEMA: YamlSchemaNode = {
  keys: {
    project: null,
    gateways: { keys: {}, wildcard: GATEWAY_NODE },
    default_gateway: null,
    model_defaults: MODEL_DEFAULTS_NODE,
    variables: null,
    plan: PLAN_NODE,
    format: FORMAT_NODE,
    linter: LINTER_NODE,
    ui: { keys: { format_on_save: null } },
    janitor: { keys: { warn_on_crash: null } },
    run: { keys: { environment_ttl: null } },
    snapshot_ttl: null,
    environment_ttl: null,
    environment_suffix_target: null,
    environment_catalog_mapping: null,
    pinned_environments: null,
    default_target_environment: null,
    physical_schema_mapping: null,
    physical_schema_override: null,
    physical_table_naming_convention: null,
    model_naming: { keys: { infer_names: null } },
    before_all: null,
    after_all: null,
    cache_dir: null,
    log_limit: null,
    time_column_format: null,
    infer_python_dependencies: null,
    disable_anonymized_analytics: null,
  },
};

const ROWS_NODE: YamlSchemaNode = {
  keys: {
    rows: null,
    columns: null,
    query: null,
    csv: null,
    format: null,
    partial: null,
  },
};

const OUTPUTS_NODE: YamlSchemaNode = {
  keys: {
    query: ROWS_NODE,
    ctes: { keys: {}, wildcard: ROWS_NODE },
    partial: null,
  },
};

const TEST_NODE: YamlSchemaNode = {
  keys: {
    model: null,
    description: null,
    inputs: { keys: {}, wildcard: ROWS_NODE },
    outputs: OUTPUTS_NODE,
    vars: null,
    gateway: null,
  },
};

const TEST_SCHEMA: YamlSchemaNode = {
  keys: {},
  wildcard: TEST_NODE,
};

const SCHEMAS: Record<SqlMeshYamlFileType, YamlSchemaNode> = {
  config: CONFIG_SCHEMA,
  test: TEST_SCHEMA,
};

function detectSqlMeshYamlFileType(
  fileName: string,
  content: string,
): SqlMeshYamlFileType | null {
  const base = fileName.split("/").pop() ?? fileName;
  if (base === "config.yaml" || base === "config.yml") return "config";
  if (/^test.*\.ya?ml$/i.test(base)) return "test";

  const lines = content.split("\n").slice(0, 40);
  const topKeys = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^(\w[\w-]*):/);
    if (m) topKeys.add(m[1]);
  }
  if (
    topKeys.has("gateways") ||
    topKeys.has("model_defaults") ||
    topKeys.has("default_gateway")
  ) {
    return "config";
  }
  if (/\n\s+model:\s/.test(content) && /\n\s+(inputs|outputs):/.test(content)) {
    return "test";
  }

  return null;
}

function schemaForFileType(fileType: SqlMeshYamlFileType): YamlSchemaNode {
  return SCHEMAS[fileType];
}

function completionKeysForPath(
  fileType: SqlMeshYamlFileType,
  path: string[],
): string[] {
  const node = resolveSchemaPath(schemaForFileType(fileType), path);
  if (!node) return [];

  const keys = Object.keys(node.keys);
  if (node.listItem) {
    return [...keys, ...Object.keys(node.listItem.keys)];
  }
  return keys;
}

// The resolved YAML key-path at the cursor line: what `analyze` hands to
// `suggest`.
interface SqlMeshYamlSituation {
  path: string[];
}

class SqlMeshYamlCompletionProvider extends CompletionProvider<SqlMeshYamlSituation> {
  private readonly fileType: SqlMeshYamlFileType;

  constructor(fileType: SqlMeshYamlFileType) {
    super();
    this.fileType = fileType;
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<SqlMeshYamlSituation> | null {
    const docText = cc.state.doc.toString();
    const line = cc.state.doc.lineAt(cc.pos);
    const lineNumber = line.number - 1;

    const beforeCursorStripped = line.text.slice(0, cc.pos - line.from).trimStart();

    const wordMatch = cc.matchBefore(/[\w+\-.]*/);
    if (!wordMatch && !cc.explicit) return null;
    const from = wordMatch?.from ?? cc.pos;

    // A value already typed after the colon is not a key position.
    if (beforeCursorStripped.includes(":") && !cc.explicit) {
      const colonIdx = beforeCursorStripped.indexOf(":");
      const afterColon = beforeCursorStripped.slice(colonIdx + 1);
      if (afterColon.trim().length > 0) return null;
    }

    return {
      from,
      situation: { path: yamlPathAtCursor(docText, lineNumber) },
      filter: true,
    };
  }

  protected suggest(situation: SqlMeshYamlSituation): Completion[] {
    return completionKeysForPath(this.fileType, situation.path).map((key) => ({
      label: key,
      type: "property",
      boost: 1,
    }));
  }
}

export {
  SqlMeshYamlCompletionProvider,
  completionKeysForPath,
  detectSqlMeshYamlFileType,
  schemaForFileType,
};

export type {
  SqlMeshYamlFileType,
};
