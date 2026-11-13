# arris

Arris for Claude Code, Codex, Cursor and GitHub Copilot. Query your databases, explore dbt and SQLMesh projects, and build canvases with the `arris` skill.

## Install

```sh
npx arris
```

This installs the arris skill to `~/.claude/skills/arris` (Claude Code) and `~/.agents/skills/arris` (Codex, Cursor and GitHub Copilot), and the `arris` binary to `~/.arris/bin/arris`. Restart your agent, then type `/arris` in Claude Code, Cursor or Copilot, or `$arris` in Codex.

- `npx arris --project` installs the skill into `./.claude/skills/arris` and `./.agents/skills/arris` for the current project only.
- Run `npx arris` again to upgrade. An existing skill folder is moved to `~/.arris/skill-backups/arris-<agent>-<time>` first.
- `npx arris <command>` runs the arris CLI, for example `npx arris connection list`.

Supported platforms: macOS (Apple silicon and Intel) and Linux (x64 and arm64). Set `ARRIS_BINARY` to use an arris binary you built yourself.

Docs: https://docs.arrisdb.app
