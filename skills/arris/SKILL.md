---
name: arris
description: Connect to a database or data warehouse and answer data questions with SQL through the local arris CLI. Use when the user wants to connect a database, query data, asks data questions ("how many", "what are", "top N"), or types /arris. Also use in a dbt or SQLMesh project to read models, trace lineage, or run dbt/sqlmesh commands.
---

# Arris

Arris runs SQL against the user's databases through the local `arris` CLI. Every command prints JSON on stdout. Full flags and output shapes: [reference/cli.md](reference/cli.md).

## Intent

Look at the first argument after `/arris` (`$arris` in Codex):

- `init-connection`: set up a new connection.
- `query <question>`: answer a data question.
- `dbt [<question or task>]`: work with the dbt project (see dbt).
- `sqlmesh [<question or task>]`: work with the SQLMesh project (see sqlmesh).
- No argument (bare `/arris` or `$arris`): open the Arris UI (see ui).
- Anything else (including a bare question): treat it as `query`.

## Always first

Find the arris binary: run `command -v arris`, else check that `~/.arris/bin/arris` exists. Use whichever path you found as `arris` in every command below.
If neither exists, stop and tell the user: "The arris CLI is not installed. Run `npx arris` in a terminal, then restart your agent."

## Security

- Never ask the user to paste passwords, tokens or keys into chat. Credentials are entered only in the browser form that `arris connection new` opens.
- Commands may print URLs containing a one-time local login token. Do not print, repeat or share those URLs outside the user's machine. The `uiUrl` from `query` may be shown to the user, but not pasted into any other tool or service.

## ui

Run `arris ui --open`. It opens the project's Arris UI in the browser. Tell the user it opened; do not print the URL, which carries the login token. If the browser did not open, rerun as `arris ui` and tell the user to open the printed `url` themselves.

## init-connection

1. Run `arris connection new` (add `--kind <kind>` if the user named a database type, e.g. `postgres`). If the user gave a connection URI, pass it as `--url <uri>` instead of `--kind`; the form opens with host, port, user, database and options filled in. Remove any password from the URI first; the user types it in the form.
2. Tell the user a browser form opened and to fill it in there. Do not ask for credentials in chat.
3. After the user saves, macOS may show a Keychain access prompt for `arris`. Tell them to approve it (Always Allow); the command waits until the form is saved and they approve. On success it prints `{"connectionId","name"}`; confirm the connection name to the user.
4. Exit code 3 means the form was cancelled or timed out: report that it was cancelled and offer to try again. Exit code 2 means the server could not start (see the reference).
5. If the browser did not open, rerun with `--no-open`; the form URL is printed on stderr for the user to open themselves.

To change a saved connection (host, database, user, options, password), run `arris connection edit <conn>`. The same form opens filled in with the saved values; tell the user to change them and save. It waits and prints `{"connectionId","name"}` like `connection new`. Never remove and re-create a connection to change it.

## query

1. Run `arris connection list`. Pick the connection. Ask the user which one only if there is more than one and the question does not make it clear. If there are none, run the `init-connection` flow first.
2. Run `arris schema <conn>` to see schemas, tables and columns, then `arris schema <conn> --schema <name>` to drill into one schema when the output is large or truncated (skip the flag for engines without schemas, e.g. SQLite). Always inspect the schema before writing SQL; never guess table or column names.
3. Run `arris query <conn> --sql "<SQL>" --limit 100 --open --note "<what this query answers, under 10 words>"`. It appends the query, under a comment with the note, to this session's console tab for the connection (titled with your agent and a short session id, e.g. "Claude 1a2b3c4d" or "Codex 1a2b3c4d"; Cursor chats share one "Cursor" console), opening the browser if needed; every query of this session lands in that tab. Add `--new-tab` only when the user asks for a separate tab. For long SQL, write it to a file and use `--file <path>`. For MongoDB, write one mongo shell statement per query in strict JSON (quoted keys), not SQL. Always name the database from `arris schema`, e.g. `db.appdb.orders.countDocuments({})` or `db.appdb.orders.aggregate([{"$group": ...}])`; a bare `db.orders` reads the connection's default database, which may be empty. `getSiblingDB` and shell helpers like `ISODate()` are not supported.
4. Read-only queries (SELECT-style SQL, and MongoDB `find`, `countDocuments`, `distinct` or `aggregate` without `$out`/`$merge`) run and come back with `rows`; the tab shows the same result. Answer the question in plain words, in a short note. Do not repeat the rows as a table or print a link; the user sees them in Arris. If `truncated` is true, say the result was cut off at the limit.
5. Anything else is a write. When the user explicitly asked for that change, add `--allow-write`: it runs, the tab shows the result, and you report what changed. Without the flag it returns `awaitingRun: true` and has not run; tell the user to press Run in Arris. Do not run it another way, and do not assume it ran.
6. On a SQL error (`query_failed`), read the message, fix the SQL, and retry. Retry at most 2 times, then show the user the error and what you tried.

Failures (also for `connection list` and `schema`):

- Exit 2 (`server_unavailable`): report it and stop. Do not retry in a loop. Suggest reinstalling with `npx arris` or running `arris serve` to see why the server fails.
- A macOS Keychain prompt for `arris` can also appear on the first command after the server starts (it reads stored passwords then). Tell the user to approve it (Always Allow); the command waits until they do.
- Exit 1 with `connection_not_found` or `connection_failed`: do not rewrite the SQL. Suggest `arris connection list` and `arris connection test <conn>`, or re-creating the connection with `init-connection`.

To read more rows of a query that already ran (the next page, or rows cut off by `--limit`), run `arris result <runId> --offset <n> --limit <n>` instead of running the query again. It reads the saved result and prints `{columns, rows, totalRows, hasMore}`.

Results: `rowCount` is the number of rows returned, capped at `--limit`. When `truncated` is true the total row count is unknown, so never report `rowCount` as the total. If `truncated` is true, say so and suggest narrowing with WHERE or aggregation, or raising `--limit`. Prefer aggregate SQL (`count(*)`, `sum`, `group by`) over fetching rows to count or total them.

`<conn>` is a connection id or its name (case-insensitive).

## Canvas

When the user asks for a dashboard or board, or to put a result on a canvas:

1. Answer with `query` first so there is a run to add.
2. Pick the canvas: `arris canvas list`, or `arris canvas new "<title>"` if none fits. Titles can repeat, so pass the canvas `id` from `canvas list` (a title that matches two canvases fails with `ambiguous`).
3. Run `arris canvas add <canvas> --run <runId>`, with `--title "..."` to name the object. When a chart was asked for, add `--chart <kind> --x <col> --y <col>` using column names from the query's result: `--x` is the category or time column, `--y` a numeric column (repeat `--y` for several series). Kinds: bar, line, area, pie, donut, scatter, bubble, combo, histogram, radar, treemap, funnel, kpi. Pick bar for categories, line for time.
4. The open Arris tab switches to the board, or a browser opens on it; do not open the `uiUrl` yourself. The board runs read queries by itself when it opens and draws the chart; a write waits for the user to press Run.

To fix a canvas, take object ids from `arris canvas show <canvas>`:

- `arris canvas chart <canvas> <chartId> --chart <kind> --x <col> --y <col>` redraws a chart with a new type or axes.
- `arris canvas remove <canvas> <objectId>` removes one object and its arrows. Removing a query leaves its chart without data, so remove the chart too unless the user wants to rebind it.
- `arris canvas delete <canvas>` deletes the whole canvas. Run it only when the user asks to delete the canvas.

Never invent connection ids: `--sql` with `--connection` takes a name or id from `arris connection list`.

## dbt

Use when the user says `/arris dbt`, or asks about models in a project with a `dbt_project.yml`.

1. Run `arris dbt models` first. If it fails with `dbt_project_not_found`, look for `dbt_project.yml` in subfolders and pass that folder with `--dir <folder>` on every `arris dbt` command. With several projects, ask which one.
2. Read the models that matter with `arris dbt model <name>`: its SQL, columns, upstream and downstream models. Answer questions about logic from the SQL; never guess a model's columns.
3. For lineage questions run `arris dbt lineage <model>` (add `--column <col>` to trace a column). Give the user the `uiUrl` so they can see the graph.
4. To answer with data, query the model's table through `arris query`. Find the connection with `arris connection list`; if there is none for the warehouse, run `arris dbt sync` once (add `--target <t>` if the user named one). It opens a prefilled browser form; tell the user to enter the password there. Build the table name from the model's `schema` and `name`, check it with `arris schema <conn> --schema <schema>`, then follow the query steps.
5. Run dbt commands only as `arris dbt cli -- <dbt args>` (e.g. `arris dbt cli -- run --select orders`), never plain `dbt`, so the run is logged. The command exits with dbt's exit code and prints `{runId, exitCode, summary, uiUrl}`; report the summary and failed nodes, and give the `uiUrl`. Ask before commands that write to the warehouse (`run`, `build`, `seed`, `snapshot`) unless the user asked for them. Exit 127 with `tool_not_found` means dbt is not on PATH: ask the user to activate their virtualenv or set `ARRIS_DBT_BIN`.
6. Column lineage reads compiled SQL. If it comes back empty, offer to run `arris dbt cli -- compile` first.

Never edit `profiles.yml`, and never print values from it. Credentials go only in the browser form.

## sqlmesh

Same flow as dbt with `arris sqlmesh`: `models` (fails with `sqlmesh_project_not_found` when there is no `config.yaml`; use `--dir`), `model <name>` (fully qualified names such as `sushi.orders`), `lineage`, `sync` (`--gateway <g>`), and `cli -- <sqlmesh args>` (e.g. `arris sqlmesh cli -- plan dev`). Ask before `plan` applies changes or `run` writes data unless the user asked for it. Never edit the SQLMesh config or print secrets from it.

## Read-only by default

Do not run INSERT, UPDATE, DELETE or DDL (CREATE, ALTER, DROP, TRUNCATE), or MongoDB inserts, updates and deletes, unless the user explicitly asked for that change. When they did, run it with `--allow-write` and say what it changed. If the request is ambiguous, or the statement would change much more than they described (e.g. a DELETE or UPDATE with no WHERE), show the SQL and ask first.

## Other commands

`arris context` shows the UI's active tab, its text and the user's selection; run it when the user says "this query", "the selected part" or similar. `arris tab list` lists the UI's open tabs; `arris tab close <id>...` closes some, `arris tab close --all-except <id>` all but one (this session's console is the one titled with your agent and session id). `arris history` lists recent runs. `arris pin <run-id> --title "..."` saves a run, `arris pins` lists pins, `arris unpin <id>` removes one. `arris connection test|remove <conn>` check or delete a connection (confirm before removing). Use these when the user asks for them.
