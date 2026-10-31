# arris CLI reference

All commands print compact JSON on stdout (add `--pretty` to indent). The CLI auto-starts a local server on first use. URLs it prints contain a one-time local login token: keep them on the user's machine.

## Global flags

- `--project <PATH>`: project root; defaults to the current directory. History and pins are kept per project.
- `--pretty`: pretty-print JSON.

`<conn>` below is a connection id or a case-insensitive connection name.

## Commands

### `arris serve [--port N] [--open]`
Run the local server in the foreground. `--port` picks the port (OS chooses if omitted); `--open` opens the UI in a browser. Rarely needed, other commands start the server automatically.

### `arris connection list`
Prints a JSON array of saved connections (`id`, `name`, `kind`, host/database fields; secrets are never included).

### `arris connection new [--kind K] [--no-open]`
Opens a browser form and waits (up to 10 minutes) until it is saved or cancelled. `--kind` preselects a database type (an invalid kind prints the valid ones). `--no-open` prints the form URL without opening a browser. The form URL is printed on stderr as `{"url": "..."}`. On save, stdout is `{"connectionId": "<uuid>", "name": "<name>"}`.

### `arris connection test <conn>`
Tests a saved connection. Prints `{"ok":true}` on success.

### `arris connection remove <conn>`
Deletes a saved connection.

### `arris schema <conn> [--schema S]`
Prints a JSON tree of nodes `{name, kind, path, detail, children}`. `kind` is `database`, `schema`, `table` or `column`; for columns `detail` is the data type. Without `--schema` it lists the top levels with their tables and columns where the engine provides them; `--schema S` narrows to one schema (engines without schemas, such as SQLite, return `[]`, so omit the flag there).

### `arris query <conn> (--sql SQL | --file PATH) [--limit N] [--open]`
Exactly one of `--sql` or `--file` is required. `--limit` caps returned rows (default 1000). Output:

```json
{"runId":"...","columns":[{"name":"n","type_hint":""}],"rows":[[42]],"rowCount":1,"truncated":false,"uiUrl":"http://127.0.0.1:PORT/?token=...&next=..."}
```

Rows are arrays of plain JSON values, in column order. `rowCount` is the number of rows returned, capped at `--limit`. `truncated` is true when more rows exist than were returned; the total is then unknown. `uiUrl` opens this run's result page in the Arris UI (the rows the query fetched, up to `--limit`).

With `--open`, the query also appears in an Arris console tab, opening the browser if no tab is open. Read-only SQL runs once and prints the fields above, without `uiUrl`. Anything else, or anything the check cannot prove read-only, does not run and prints `{"awaitingRun": true}`; the user presses Run in the tab.

### `arris history [--limit N]`
JSON array of runs, newest first: `id`, `sql`, `status` (`success` or `error`), `error`, `rowCount`, `connectionId`, `source`, `startedAt`, `finishedAt`.

### `arris pin <run-id> [--title T]`
Pins a run from history and prints the pin `{id, name, text, connectionId, kind}`. The name defaults to the run's SQL. Pins are shared with the Arris desktop app.

### `arris unpin <id>`
Removes a pin by its pin `id` (not the run id).

### `arris pins`
JSON array of pins.

### `arris canvas new <title>`
Creates a canvas and prints `{id, title, uiUrl}`.

### `arris canvas list`
JSON array of canvases, newest first: `id`, `title`, `revision`, `componentCount`, `createdAt`, `updatedAt`.

### `arris canvas show <canvas>`
Prints `{id, title, revision, components}`; each component has `id`, `kind` and, when set, `title`, `sql`, `connectionId`. Layout is left out.

### `arris canvas add <canvas> (--run ID | --sql SQL --connection C) [--title T] [--chart]`
Appends a query object below the canvas's lowest object. `--run` copies a run's SQL and connection; `--sql` needs `--connection`. `--chart` also adds a chart bound to the query. The title defaults to the first SQL line. Prints `{canvasId, queryId, chartId?, uiUrl}`.

`<canvas>` is a canvas id or its exact title. A title shared by several canvases exits 1 with `ambiguous` and lists their ids.

### `arris dbt models [--dir D]` and `arris sqlmesh models [--dir D]`
Lists models without SQL. dbt prints `{projectName, root, models}`; each model has `uniqueId`, `name`, `schema`, `materialized`, `dependsOn`, `path`. sqlmesh prints `{root, models}`; each has `name`, `kind`, `cron`, `owner`, `dependsOn`, `path`. `--dir` is the tool project folder relative to the project root (default: the root); a folder outside it fails with `forbidden`.

### `arris dbt model <name> [--dir D]` and `arris sqlmesh model <name> [--dir D]`
One model: the summary fields plus `description`, `rawSql`, `columns` (`name`, `description`, `type`), `upstream`, `downstream`, and for dbt `compiledSql` (from `target/compiled`, null until `dbt compile` ran). dbt accepts a name or unique id; sqlmesh the fully qualified name.

### `arris dbt lineage [<model>] [--column C] [--dir D]` (same for `sqlmesh`)
Prints `{graph: {nodes, edges}, columns?, uiUrl}`. Without a model, the whole project; with one, its ancestors and descendants. `--column` adds `columns`: the upstream columns that feed it (`nodes` of `{modelId, columns}`, `edges` of `{fromModel, fromColumn, toModel, toColumn}`).

### `arris dbt sync [--target T] [--dir D] [--no-open]` and `arris sqlmesh sync [--gateway G] ...`
Creates a connection from the dbt profile target (`<profile>-<target>`) or sqlmesh gateway (`sqlmesh-<gateway>`) through the browser form, prefilled with non-secret fields. If a connection with that name exists it is reused. Prints `{connectionId, name, reused}`. Exit 3 when the form is cancelled, as for `connection new`.

### `arris dbt cli [--dir D] -- <args>` and `arris sqlmesh cli [--dir D] -- <args>`
Runs the native tool with `<args>` in the terminal's environment, streaming its output, and logs the run. Prints `{runId, exitCode, summary, uiUrl}`; `summary` (dbt only) has `success`, `error`, `skipped`, `warn` counts and `failed` node ids. Exits with the tool's exit code. `ARRIS_DBT_BIN` / `ARRIS_SQLMESH_BIN` override the executable.

### `arris ui [--open]`
Prints `{"url": "..."}` of the UI for the project; `--open` also opens it in a browser.

## Errors and exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | API error |
| 2 | Server unavailable (could not start or reach it) |
| 3 | `connection new` or `sync` cancelled or timed out |
| 127 | `dbt cli` / `sqlmesh cli`: the tool is not installed (`tool_not_found`) |
| other | `dbt cli` / `sqlmesh cli`: the tool's own exit code |

Failures print `{"error":{"code":"...","message":"..."}}` on stdout. Common codes: `query_failed` (bad SQL, read the message), `connection_not_found`, `connection_failed`, `canvas_not_found`, `ambiguous` (canvas title matches several), `run_not_found`, `invalid_kind`, `server_unavailable`, `cancelled`, `timeout`.

dbt and sqlmesh codes: `dbt_project_not_found` / `sqlmesh_project_not_found` (no project in the folder; the message names the path, pass `--dir`), `dir_not_found`, `forbidden` (`--dir` outside the project root), `model_not_found`, `tool_not_found`, `tool_run_not_found`, `unsupported_adapter`, `project_config_not_found` and `project_config_invalid` (`sync` could not find or parse the profile or gateway).

## Environment

- `ARRIS_DATA_DIR`: override where Arris keeps its data (default: the OS data directory).
- `ARRIS_DBT_BIN`, `ARRIS_SQLMESH_BIN`: dbt / sqlmesh executable for `cli` (default: found on `PATH`).
- `DBT_PROFILES_DIR`: where `dbt sync` reads `profiles.yml`, as for dbt.
