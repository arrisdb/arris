# arris

Arris for Claude Code. Query your databases, explore dbt and SQLMesh projects, and build canvases by typing `/arris` in Claude Code.

## Install

```sh
npx arris
```

This installs the arris skill to `~/.claude/skills/arris` and the `arris` binary to `~/.arris/bin/arris`. Restart Claude Code, then type `/arris`.

- `npx arris --project` installs the skill into `./.claude/skills/arris` for the current project only.
- Run `npx arris` again to upgrade. An existing skill folder is moved to `~/.claude/skills/.arris-backup-<time>` first.
- `npx arris <command>` runs the arris CLI, for example `npx arris connection list`.

Supported platforms: macOS (Apple silicon and Intel) and Linux (x64 and arm64). Set `ARRIS_BINARY` to use an arris binary you built yourself.

Docs: https://docs.arrisdb.app
