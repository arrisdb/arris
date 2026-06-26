// Autocomplete for the two Redis console modes.
//
// SQL mode (`redis`): the engine accepts a small SQL-flavored grammar
// (drivers/redis/parser.rs):
//   SELECT * FROM keys [WHERE key LIKE 'pat'] [LIMIT n]   : list the keyspace
//   SELECT * FROM "<key>"                                 : read one key
//   SELECT * FROM dbN.<key>                               : read a key in db N
// The generic SQL completer is useless here (redis keys are not tabular and the
// `keys` virtual table / `dbN.` prefix are unknown to it), so this provider models
// the grammar directly, offering keys from the cached schema.
//
// CLI mode (`rediscli`): one raw Redis command per line, `VERB key [args...]`.
// The first token completes to a command verb; later tokens complete to keys.

import {
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { REDIS_COMMANDS } from "../../dialects/connections/redisCliLanguage";
import { CompletionProvider, type CompletionAnalysis } from "../core/provider";
import type { SqlSchemaDict } from "../sqlSchema";

interface RedisCompletionOpts {
  schema: SqlSchemaDict;
}

interface RedisKeyspace {
  // Database container names that hold keys, e.g. `db0`, `db1`.
  dbs: string[];
  // Keys grouped by their owning database container.
  keysByDb: Map<string, string[]>;
  // Every distinct bare key name across all databases.
  allKeys: string[];
}

const DB_PREFIX_RE = /^(db\d+)\.(.+)$/;

// `buildSqlSchema` registers redis keys both bare (`cache:stats`) and qualified
// by their db container (`db1.cache:stats`). Split those back into a keyspace.
function parseKeyspace(schema: SqlSchemaDict): RedisKeyspace {
  const dbs = new Set<string>();
  const keysByDb = new Map<string, string[]>();
  const allKeys = new Set<string>();
  for (const entry of Object.keys(schema)) {
    const match = DB_PREFIX_RE.exec(entry);
    if (match) {
      const [, db, key] = match;
      dbs.add(db);
      const list = keysByDb.get(db) ?? [];
      if (!list.includes(key)) list.push(key);
      keysByDb.set(db, list);
    } else {
      allKeys.add(entry);
    }
  }
  return {
    dbs: [...dbs].sort(),
    keysByDb,
    allKeys: [...allKeys].sort(),
  };
}

// Re-fires the completion menu after inserting `text`, so the next level
// (e.g. the keys under a just-picked `db1.` prefix) is offered immediately.
function applyAndContinue(text: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    startCompletion(view);
  };
}

function keyOptions(keys: string[]): Completion[] {
  return keys.map((key) => ({ label: key, type: "variable", detail: "key" }));
}

function dbPrefixOptions(dbs: string[]): Completion[] {
  return dbs.map((db) => ({
    label: `${db}.`,
    type: "namespace",
    detail: "database",
    apply: applyAndContinue(`${db}.`),
  }));
}

// ---- SQL mode -------------------------------------------------------------

type RedisSqlState =
  | "select"
  | "expectFrom"
  | "source"
  | "clause"
  | "whereField"
  | "whereOp"
  | "none";

interface RedisSqlSituation {
  state: RedisSqlState;
  partial: string;
}

// Captures the partial token at the cursor. A FROM source / key may contain
// `:`, `.`, `-` and `*`, so the word boundary is wider than a SQL identifier.
const SQL_PARTIAL_RE = /[\w:.*\-]*$/;
const SQL_VALID_FOR = /^[\w:.*\-]*$/;

function analyzeRedisSql(before: string): RedisSqlSituation {
  const partial = SQL_PARTIAL_RE.exec(before)?.[0] ?? "";
  const head = before.slice(0, before.length - partial.length);
  const tokens = head
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  if (!tokens.includes("select")) return { state: "select", partial };

  const fromIdx = tokens.lastIndexOf("from");
  if (fromIdx === -1) return { state: "expectFrom", partial };

  const afterFrom = tokens.slice(fromIdx + 1);
  if (afterFrom.length === 0) return { state: "source", partial };

  const whereIdx = tokens.lastIndexOf("where");
  if (whereIdx > fromIdx) {
    const afterWhere = tokens.slice(whereIdx + 1);
    if (afterWhere.length === 0) return { state: "whereField", partial };
    if (afterWhere.length === 1) return { state: "whereOp", partial };
    return { state: "none", partial };
  }

  if (tokens[tokens.length - 1] === "limit") return { state: "none", partial };
  return { state: "clause", partial };
}

function redisSqlOptions(state: RedisSqlState, partial: string, ks: RedisKeyspace): Completion[] {
  switch (state) {
    case "select":
      return [
        snippetCompletion("SELECT * FROM ${}", {
          label: "SELECT",
          type: "keyword",
          detail: "read keys",
          boost: 2,
        }),
      ];
    case "expectFrom":
      return [{ label: "FROM", type: "keyword", apply: applyAndContinue("FROM ") }];
    case "source": {
      // A `dbN.` prefix (even before any key chars) narrows to that db's keys.
      const dbMatch = /^(db\d+)\./.exec(partial);
      if (dbMatch) {
        const db = dbMatch[1];
        return keyOptions(ks.keysByDb.get(db) ?? []).map((option) => ({
          ...option,
          label: `${db}.${option.label}`,
        }));
      }
      return [
        { label: "keys", type: "class", detail: "list the keyspace", boost: 1 },
        { label: "keyspace", type: "class", detail: "list the keyspace" },
        ...dbPrefixOptions(ks.dbs),
        ...keyOptions(ks.allKeys),
      ];
    }
    case "clause":
      return [
        { label: "WHERE", type: "keyword", apply: applyAndContinue("WHERE ") },
        { label: "LIMIT", type: "keyword", apply: applyAndContinue("LIMIT ") },
      ];
    case "whereField":
      return [{ label: "key", type: "property", apply: applyAndContinue("key ") }];
    case "whereOp":
      return [
        { label: "LIKE", type: "keyword", apply: applyAndContinue("LIKE ") },
        { label: "=", type: "keyword", apply: applyAndContinue("= ") },
      ];
    default:
      return [];
  }
}

class RedisSqlCompletionProvider extends CompletionProvider<RedisSqlSituation> {
  private readonly ks: RedisKeyspace;

  constructor(opts: RedisCompletionOpts) {
    super();
    this.ks = parseKeyspace(opts.schema);
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<RedisSqlSituation> | null {
    const before = cc.state.sliceDoc(0, cc.pos);
    const situation = analyzeRedisSql(before);

    // Don't pop the menu unasked on a blank document.
    if (situation.state === "select" && !situation.partial && !cc.explicit) return null;

    return {
      from: cc.pos - situation.partial.length,
      situation,
      // Keys/prefixes contain `:` and `.`; keep the menu open while typing them.
      validFor: SQL_VALID_FOR,
    };
  }

  protected suggest(situation: RedisSqlSituation): Completion[] {
    return redisSqlOptions(situation.state, situation.partial, this.ks);
  }
}

// ---- CLI mode -------------------------------------------------------------

const CLI_PARTIAL_RE = /\S*$/;
const CLI_VALID_FOR = /^\S*$/;

interface RedisCliSituation {
  isCommandPosition: boolean;
}

function commandOptions(): Completion[] {
  return REDIS_COMMANDS.map((cmd) => ({ label: cmd, type: "keyword", detail: "command" }));
}

class RedisCliCompletionProvider extends CompletionProvider<RedisCliSituation> {
  private readonly ks: RedisKeyspace;

  constructor(opts: RedisCompletionOpts) {
    super();
    this.ks = parseKeyspace(opts.schema);
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<RedisCliSituation> | null {
    const lineStart = cc.state.doc.lineAt(cc.pos).from;
    const lineBefore = cc.state.sliceDoc(lineStart, cc.pos);
    if (lineBefore.trimStart().startsWith("#")) return null;

    const partial = CLI_PARTIAL_RE.exec(lineBefore)?.[0] ?? "";
    const head = lineBefore.slice(0, lineBefore.length - partial.length);
    // First token on the line is the command; everything after is an argument.
    const isCommandPosition = head.trim().length === 0;

    // Only stay silent on a blank command position; in argument position the
    // user has already committed to a command, so offer keys even before typing.
    if (isCommandPosition && !partial && !cc.explicit) return null;

    return {
      from: cc.pos - partial.length,
      situation: { isCommandPosition },
      validFor: CLI_VALID_FOR,
    };
  }

  protected suggest(situation: RedisCliSituation): Completion[] {
    return situation.isCommandPosition ? commandOptions() : keyOptions(this.ks.allKeys);
  }
}

export {
  RedisCliCompletionProvider,
  RedisSqlCompletionProvider,
};

export type {
  RedisCompletionOpts,
};
