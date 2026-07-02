import type { Completion, CompletionContext } from "@codemirror/autocomplete";

import { CompletionProvider, type CompletionAnalysis } from "../core/provider";
import { docString } from "../../docText";

type DbtYamlFileType = "project" | "schema" | "packages" | "profiles";

interface YamlSchemaNode {
  keys: Record<string, YamlSchemaNode | null>;
  listItem?: YamlSchemaNode;
  wildcard?: YamlSchemaNode;
}

const COLUMN_NODE: YamlSchemaNode = {
  keys: {
    name: null,
    description: null,
    data_type: null,
    constraints: null,
    tests: null,
    tags: null,
    meta: null,
    quote: null,
  },
};

const MODEL_CONFIG_NODE: YamlSchemaNode = {
  keys: {
    materialized: null,
    schema: null,
    database: null,
    tags: null,
    meta: null,
    persist_docs: null,
    full_refresh: null,
    enabled: null,
    pre_hook: null,
    post_hook: null,
    grants: null,
    docs: null,
    contract: null,
    access: null,
    group: null,
  },
};

const FRESHNESS_NODE: YamlSchemaNode = {
  keys: {
    warn_after: { keys: { count: null, period: null } },
    error_after: { keys: { count: null, period: null } },
    loaded_at_field: null,
  },
};

const SOURCE_TABLE_NODE: YamlSchemaNode = {
  keys: {
    name: null,
    description: null,
    identifier: null,
    loaded_at_field: null,
    freshness: FRESHNESS_NODE,
    columns: { keys: {}, listItem: COLUMN_NODE },
    quoting: null,
    tags: null,
    meta: null,
    config: null,
    external: null,
    tests: null,
  },
};

const SCHEMA_SCHEMA: YamlSchemaNode = {
  keys: {
    version: null,
    models: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          config: MODEL_CONFIG_NODE,
          columns: { keys: {}, listItem: COLUMN_NODE },
          docs: null,
          tests: null,
          data_tests: null,
          access: null,
          constraints: null,
          versions: null,
          latest_version: null,
          deprecation_date: null,
          group: null,
          meta: null,
          contract: null,
        },
      },
    },
    sources: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          database: null,
          schema: null,
          loader: null,
          loaded_at_field: null,
          freshness: FRESHNESS_NODE,
          tables: { keys: {}, listItem: SOURCE_TABLE_NODE },
          tags: null,
          meta: null,
          config: null,
          overrides: null,
        },
      },
    },
    seeds: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          config: {
            keys: {
              schema: null,
              database: null,
              tags: null,
              meta: null,
              enabled: null,
              grants: null,
              docs: null,
              quote_columns: null,
              column_types: null,
            },
          },
          columns: { keys: {}, listItem: COLUMN_NODE },
          docs: null,
          tests: null,
        },
      },
    },
    snapshots: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          config: {
            keys: {
              strategy: null,
              unique_key: null,
              updated_at: null,
              check_cols: null,
              schema: null,
              database: null,
              tags: null,
              meta: null,
              enabled: null,
              grants: null,
              docs: null,
            },
          },
          columns: { keys: {}, listItem: COLUMN_NODE },
          docs: null,
          tests: null,
        },
      },
    },
    exposures: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          type: null,
          url: null,
          maturity: null,
          owner: { keys: { name: null, email: null } },
          depends_on: null,
          tags: null,
          meta: null,
          config: null,
        },
      },
    },
    metrics: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          type: null,
          label: null,
          type_params: null,
          filter: null,
          config: null,
          meta: null,
        },
      },
    },
    macros: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          docs: null,
          arguments: {
            keys: {},
            listItem: { keys: { name: null, type: null, description: null } },
          },
        },
      },
    },
    analyses: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          config: null,
          columns: { keys: {}, listItem: COLUMN_NODE },
          docs: null,
        },
      },
    },
    unit_tests: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          model: null,
          description: null,
          given: null,
          expect: null,
          overrides: null,
          config: null,
        },
      },
    },
    semantic_models: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          model: null,
          defaults: null,
          entities: null,
          measures: null,
          dimensions: null,
          primary_entity: null,
          config: null,
        },
      },
    },
    saved_queries: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          description: null,
          query_params: null,
          exports: null,
          config: null,
        },
      },
    },
    groups: {
      keys: {},
      listItem: {
        keys: {
          name: null,
          owner: { keys: { name: null, email: null } },
        },
      },
    },
  },
};

const RESOURCE_CONFIG_NODE: YamlSchemaNode = {
  keys: {
    "+materialized": null,
    "+schema": null,
    "+database": null,
    "+tags": null,
    "+meta": null,
    "+enabled": null,
    "+persist_docs": null,
    "+full_refresh": null,
    "+grants": null,
    "+contract": null,
    "+access": null,
    "+group": null,
    "+pre-hook": null,
    "+post-hook": null,
    "+docs": null,
  },
  get wildcard(): YamlSchemaNode { return RESOURCE_CONFIG_NODE; },
};

const PROJECT_SCHEMA: YamlSchemaNode = {
  keys: {
    name: null,
    version: null,
    "config-version": null,
    profile: null,
    "model-paths": null,
    "seed-paths": null,
    "test-paths": null,
    "snapshot-paths": null,
    "analysis-paths": null,
    "macro-paths": null,
    "asset-paths": null,
    "target-path": null,
    "log-path": null,
    "packages-install-path": null,
    "clean-targets": null,
    "require-dbt-version": null,
    quoting: null,
    models: RESOURCE_CONFIG_NODE,
    seeds: RESOURCE_CONFIG_NODE,
    snapshots: RESOURCE_CONFIG_NODE,
    tests: RESOURCE_CONFIG_NODE,
    sources: null,
    vars: null,
    "on-run-start": null,
    "on-run-end": null,
    dispatch: null,
    "restrict-access": null,
    "dbt-cloud": null,
    flags: null,
  },
};

const PACKAGES_SCHEMA: YamlSchemaNode = {
  keys: {
    packages: {
      keys: {},
      listItem: {
        keys: {
          package: null,
          version: null,
          git: null,
          revision: null,
          subdirectory: null,
          local: null,
          "warn-unpinned": null,
          "install-prerelease": null,
        },
      },
    },
  },
};

const PROFILE_OUTPUT_NODE: YamlSchemaNode = {
  keys: {
    type: null,
    host: null,
    port: null,
    user: null,
    pass: null,
    password: null,
    dbname: null,
    database: null,
    schema: null,
    threads: null,
    keepalives_idle: null,
    connect_timeout: null,
    search_path: null,
    role: null,
    sslmode: null,
    account: null,
    warehouse: null,
    method: null,
    project: null,
    dataset: null,
    keyfile: null,
    location: null,
  },
};

const PROFILES_SCHEMA: YamlSchemaNode = {
  keys: {},
  wildcard: {
    keys: {
      target: null,
      outputs: { keys: {}, wildcard: PROFILE_OUTPUT_NODE },
    },
  },
};

const SCHEMAS: Record<DbtYamlFileType, YamlSchemaNode> = {
  schema: SCHEMA_SCHEMA,
  project: PROJECT_SCHEMA,
  packages: PACKAGES_SCHEMA,
  profiles: PROFILES_SCHEMA,
};

function detectDbtYamlFileType(
  fileName: string,
  content: string,
): DbtYamlFileType | null {
  const base = fileName.split("/").pop() ?? fileName;
  if (base === "dbt_project.yml" || base === "dbt_project.yaml") return "project";
  if (base === "profiles.yml" || base === "profiles.yaml") return "profiles";
  if (base === "packages.yml" || base === "packages.yaml") return "packages";
  if (base === "dependencies.yml" || base === "dependencies.yaml") return "packages";

  const lines = content.split("\n").slice(0, 30);
  const topKeys = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^(\w[\w-]*):/);
    if (m) topKeys.add(m[1]);
  }

  const schemaIndicators = [
    "models", "sources", "seeds", "snapshots", "exposures",
    "metrics", "macros", "analyses", "unit_tests", "semantic_models",
    "saved_queries", "groups",
  ];
  if (schemaIndicators.some((k) => topKeys.has(k))) return "schema";
  if (topKeys.has("name") && topKeys.has("profile")) return "project";
  if (topKeys.has("packages")) return "packages";

  return null;
}

function yamlPathAtCursor(text: string, cursorLine: number): string[] {
  const lines = text.split("\n");
  if (cursorLine < 0 || cursorLine >= lines.length) return [];

  const currentLine = lines[cursorLine];
  const currentIndent = lineIndent(currentLine);

  const path: string[] = [];
  let targetIndent = currentIndent;

  const currentStripped = currentLine.trimStart();
  if (currentStripped.startsWith("- ")) {
    targetIndent = currentIndent;
  }

  for (let i = cursorLine; i >= 0; i--) {
    const line = lines[i];
    const stripped = line.trimStart();
    if (stripped === "" || stripped.startsWith("#")) continue;

    const indent = lineIndent(line);

    if (i === cursorLine) {
      if (stripped.startsWith("- ")) {
        path.unshift("[]");
        targetIndent = indent;
      }
      continue;
    }

    if (indent >= targetIndent) continue;

    if (stripped.startsWith("- ")) {
      path.unshift("[]");
      targetIndent = indent;
    } else {
      const keyMatch = stripped.match(/^(\S+?):/);
      if (keyMatch) {
        path.unshift(keyMatch[1]);
        targetIndent = indent;
      }
    }

    if (indent === 0) break;
  }

  return path;
}

function lineIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function schemaForFileType(fileType: DbtYamlFileType): YamlSchemaNode {
  return SCHEMAS[fileType];
}

function resolveSchemaPath(
  schema: YamlSchemaNode,
  path: string[],
): YamlSchemaNode | null {
  let node: YamlSchemaNode | null = schema;

  for (const segment of path) {
    if (!node) return null;

    if (segment === "[]") {
      if (node.listItem) {
        node = node.listItem;
      } else {
        return null;
      }
    } else {
      const child: YamlSchemaNode | null | undefined = node.keys[segment];
      if (child === undefined) {
        if (node.wildcard) {
          node = node.wildcard;
        } else if (node.listItem) {
          node = node.listItem;
          const innerChild: YamlSchemaNode | null | undefined = node.keys[segment];
          if (innerChild === undefined) return null;
          if (innerChild === null) return null;
          node = innerChild;
        } else {
          return null;
        }
      } else if (child === null) {
        return null;
      } else {
        node = child;
      }
    }
  }

  return node;
}

function completionKeysForPath(
  fileType: DbtYamlFileType,
  path: string[],
): string[] {
  const schema = schemaForFileType(fileType);
  const node = resolveSchemaPath(schema, path);
  if (!node) return [];

  const keys = Object.keys(node.keys);
  if (node.listItem) {
    return [...keys, ...Object.keys(node.listItem.keys)];
  }
  return keys;
}

// The resolved YAML key-path at the cursor line: what `analyze` hands to
// `suggest`.
interface DbtYamlSituation {
  path: string[];
}

class DbtYamlCompletionProvider extends CompletionProvider<DbtYamlSituation> {
  private readonly fileType: DbtYamlFileType;

  constructor(fileType: DbtYamlFileType) {
    super();
    this.fileType = fileType;
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<DbtYamlSituation> | null {
    const docText = docString(cc.state.doc);
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

  protected suggest(situation: DbtYamlSituation): Completion[] {
    return completionKeysForPath(this.fileType, situation.path).map((key) => ({
      label: key,
      type: "property",
      boost: 1,
    }));
  }
}

export {
  DbtYamlCompletionProvider,
  completionKeysForPath,
  detectDbtYamlFileType,
  resolveSchemaPath,
  schemaForFileType,
  yamlPathAtCursor,
};

export type {
  DbtYamlFileType,
  YamlSchemaNode,
};
