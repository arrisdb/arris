<h1 align="center">Arris</h1>

<p align="center">A modern data IDE for modern data teams.</p>

<p align="center"><a href="https://arrisdb.app"><b>arrisdb.app</b></a></p>

<p align="center">
  <a href="https://github.com/arrisdb/arris/releases/latest/download/Arris-aarch64.dmg"><b>Download for Apple Silicon</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/arrisdb/arris/releases/latest/download/Arris-x64.dmg"><b>Download for Intel</b></a>
</p>

<p align="center">
  <a href="https://github.com/arrisdb/arris/releases/latest"><img alt="Latest version" src="https://img.shields.io/github/v/release/arrisdb/arris?label=version&color=blue"></a>
  &nbsp;
  <a href="https://github.com/arrisdb/arris/actions/workflows/rust.yml"><img alt="Rust tests" src="https://img.shields.io/github/actions/workflow/status/arrisdb/arris/rust.yml?branch=main&label=Rust%20tests"></a>
  &nbsp;
  <a href="https://github.com/arrisdb/arris/actions/workflows/frontend.yml"><img alt="Frontend tests" src="https://img.shields.io/github/actions/workflow/status/arrisdb/arris/frontend.yml?branch=main&label=Frontend%20tests"></a>
</p>

---

Arris is a desktop data workbench for working with all the most popular database engines. Unlike many database clients that lean heavily on the JVM and consume large amounts of memory, Arris is built on a Rust backend with Rust-based drivers, keeping the app lightweight and fast.

And it is more than a database client: beyond writing SQL with dialect-aware autocomplete, you can join data across different databases with the DataFusion engine, work with dbt and SQLMesh through first-class support, run Python and Jupyter, and visualize query results, with more to discover as we keep improving.

This repository is the **public home for Arris releases**. It is where you download the app, read release notes, and report problems.

## Download

Grab the latest build:

| Mac | Download |
| --- | --- |
| Apple Silicon (M1 and newer) | [`Arris-aarch64.dmg`](https://github.com/arrisdb/arris/releases/latest/download/Arris-aarch64.dmg) |
| Intel | [`Arris-x64.dmg`](https://github.com/arrisdb/arris/releases/latest/download/Arris-x64.dmg) |

You can also download from [arrisdb.app/download](https://arrisdb.app/download).

Requires macOS 12 (Monterey) or later. Arris updates itself in place once installed.

## Release notes

Every version is published under [Releases](https://github.com/arrisdb/arris/releases). Each release lists what changed, the download assets, and the SHA-256 checksum for every file.

## Report an issue

Found a bug or have a feature request? Please [open an issue](https://github.com/arrisdb/arris/issues). Include your macOS version, your Arris version (Arris → About), the database engine involved, and the steps to reproduce. The more detail you give, the faster it gets fixed.

## Testing locally

Build and run the app from source with the Tauri CLI:

```bash
cargo tauri dev
```

This compiles the Rust backend and the frontend, then launches Arris with hot-reload, so you can try changes against a real build.

The `fixtures/` directory provides everything you need to exercise Arris against real data sources locally:

- `fixtures/docker-compose.yml` brings up the supported databases (Postgres, MySQL, MongoDB, ClickHouse, and more), each seeded with the same canonical sample dataset so cross-source joins line up:

  ```bash
  docker compose -f fixtures/docker-compose.yml up -d
  ```

  Connect Arris to any of them, then tear down with `docker compose -f fixtures/docker-compose.yml down -v`.
- `fixtures/sample_dbt_project`, `fixtures/sample_sqlmesh_project`, and `fixtures/sample_python_project` are ready-to-open projects for trying the dbt, SQLMesh, and Python features.

Run the test suites before opening a pull request:

```bash
cargo test          # Rust backend
cd frontend && npm test   # frontend
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

- **Bugs and ideas:** start with an [issue](https://github.com/arrisdb/arris/issues) so we can discuss before code is written.
- **Pull requests:** fork, branch, and open a PR against `main`. Keep changes focused and include tests for backend (`cargo test`) and frontend (`npm test`) where applicable.
- **Contribution license:** contributions are made under the MIT License (confirmed via a checkbox in the PR template), which keeps Arris's licensing flexible. See [CONTRIBUTING.md](CONTRIBUTING.md).

If you are planning a larger change, open an issue first so we can align on direction.

## License

Arris is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE) for the full text.

Bundled fonts and third-party dependency licenses are credited in [ATTRIBUTION.md](ATTRIBUTION.md).

## Links

- Website: [arrisdb.app](https://arrisdb.app)
- Documentation: [docs.arrisdb.app](https://docs.arrisdb.app)
- Issues: [github.com/arrisdb/arris/issues](https://github.com/arrisdb/arris/issues)
