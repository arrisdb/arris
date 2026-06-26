import type { Extension } from "@codemirror/state";
import { StandardSQL } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";

import {
  RedisCliCompletionProvider,
  RedisSqlCompletionProvider,
} from "../../autocomplete/providers/redis";
import { redisCli } from "./redisCliLanguage";
import { SqlEditorDialect } from "../sql";
import { Dialect, type EditorDialectContext } from "../types";

const DEFAULT_FONT_SIZE = 13;

// The SQL query mode: Redis exposes its keyspace as SQL-ish tables, so it uses the
// generic grammar but a Redis-specific completion source (not the warehouse one).
// Not syntax-linted.
class RedisDialect extends SqlEditorDialect {
  readonly id = "redis";
  protected readonly cmDialect = StandardSQL;

  override matches(context: EditorDialectContext): boolean {
    return context.languageId === "redis";
  }

  override completion(context: EditorDialectContext): Extension[] {
    return new RedisSqlCompletionProvider({ schema: context.schema ?? {} })
      .extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

// The CLI mode: a stream grammar for `GET key` style commands plus command-name
// completion.
class RedisCliDialect extends Dialect {
  readonly id = "rediscli";
  protected override readonly languageIds = new Set(["rediscli"]);

  language(): Extension[] {
    return [StreamLanguage.define(redisCli)];
  }

  override completion(context: EditorDialectContext): Extension[] {
    return new RedisCliCompletionProvider({ schema: context.schema ?? {} })
      .extensions(context.fontSize ?? DEFAULT_FONT_SIZE);
  }
}

export {
  RedisCliDialect,
  RedisDialect,
};
