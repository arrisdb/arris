// Syntax highlighting + command vocabulary for the native Redis CLI console
// (`rediscli`). Each line is one command: `VERB key [args...]`. The first token
// is highlighted as a keyword (the command), quoted args as strings, bare
// numbers as numbers, and `#` starts a comment to end of line. Everything else
// (keys, fields, members) stays plain, mirroring how `redis-cli` renders.

import type { StreamParser } from "@codemirror/language";

// Common Redis commands offered by the CLI autocomplete. Not exhaustive: the
// frequently-used verbs across the core data types plus connection/server ops.
const REDIS_COMMANDS: readonly string[] = [
  // Generic / keyspace
  "GET", "SET", "SETEX", "SETNX", "GETSET", "APPEND", "STRLEN", "INCR", "DECR",
  "INCRBY", "DECRBY", "MGET", "MSET", "DEL", "UNLINK", "EXISTS", "EXPIRE",
  "PEXPIRE", "TTL", "PTTL", "PERSIST", "TYPE", "RENAME", "KEYS", "SCAN",
  "RANDOMKEY", "DUMP", "TOUCH",
  // Hash
  "HGET", "HSET", "HSETNX", "HMGET", "HMSET", "HGETALL", "HDEL", "HKEYS",
  "HVALS", "HLEN", "HEXISTS", "HINCRBY", "HSCAN",
  // List
  "LPUSH", "RPUSH", "LPOP", "RPOP", "LRANGE", "LLEN", "LINDEX", "LSET",
  "LREM", "LTRIM", "RPOPLPUSH",
  // Set
  "SADD", "SREM", "SMEMBERS", "SCARD", "SISMEMBER", "SPOP", "SRANDMEMBER",
  "SINTER", "SUNION", "SDIFF", "SSCAN",
  // Sorted set
  "ZADD", "ZREM", "ZRANGE", "ZREVRANGE", "ZRANGEBYSCORE", "ZSCORE", "ZRANK",
  "ZREVRANK", "ZCARD", "ZCOUNT", "ZINCRBY", "ZSCAN",
  // Stream
  "XADD", "XRANGE", "XREVRANGE", "XLEN", "XREAD", "XDEL",
  // Connection / server
  "SELECT", "PING", "ECHO", "AUTH", "INFO", "DBSIZE", "FLUSHDB", "FLUSHALL",
  "CONFIG", "CLIENT", "COMMAND", "TIME",
];

interface RedisCliState {
  // True until the command verb of the current line has been consumed.
  expectCommand: boolean;
}

const redisCli: StreamParser<RedisCliState> = {
  startState: () => ({ expectCommand: true }),
  token(stream, state) {
    if (stream.sol()) state.expectCommand = true;
    if (stream.eatSpace()) return null;

    // `#` comment runs to end of line.
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    // Quoted string (single or double), with backslash escapes.
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") {
          stream.next();
          continue;
        }
        if (ch === quote) break;
      }
      state.expectCommand = false;
      return "string";
    }

    // A token that is wholly numeric.
    if (stream.match(/^-?\d+(\.\d+)?(?=\s|$)/)) {
      state.expectCommand = false;
      return "number";
    }

    // First bareword on the line is the command verb.
    if (state.expectCommand && stream.match(/^\S+/)) {
      state.expectCommand = false;
      return "keyword";
    }

    // Remaining barewords (keys, fields, members) are plain.
    stream.match(/^\S+/);
    state.expectCommand = false;
    return null;
  },
};

export {
  REDIS_COMMANDS,
  redisCli,
};
