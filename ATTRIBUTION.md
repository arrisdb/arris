# Attributions

Arris is built on the work of many open-source projects and typefaces. This page summarizes the fonts bundled with the app and the licenses of the third-party code Arris depends on. We are grateful to every author and maintainer.

Arris itself is licensed under the [GNU AGPL-3.0](LICENSE).

## Fonts

Arris bundles the following typefaces so the in-app font picker works offline. Each is used unmodified under the [SIL Open Font License 1.1](https://openfontlicense.org).

- [Inter](https://rsms.me/inter/) ([License](https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt))
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) ([License](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt))
- [Fira Code](https://github.com/tonsky/FiraCode) ([License](https://github.com/tonsky/FiraCode/blob/master/LICENSE))
- [Source Code Pro](https://github.com/adobe-fonts/source-code-pro) ([License](https://github.com/adobe-fonts/source-code-pro/blob/release/LICENSE.md))

## Code licenses

Arris ships a Rust backend and a JavaScript (React) frontend. The tables below count each dependency once, bucketed by the first license in its declared SPDX expression. Most dependencies are permissively dual-licensed (for example `MIT OR Apache-2.0`) and may be used under any of the licenses they list, so these counts are a conservative summary rather than an exclusive classification.

### Backend (Rust)

Counted across the union of the `arris-engines` workspace (all driver features enabled) and the `src-tauri` shell crate, deduplicated by crate name and version (1187 crates).

| License | Dependencies |
| --- | ---: |
| MIT | 812 |
| Apache-2.0 | 273 |
| Zlib | 21 |
| Unicode-3.0 | 18 |
| BSD-3-Clause | 15 |
| Unlicense | 14 |
| MPL-2.0 | 10 |
| ISC | 9 |
| CC0-1.0 | 5 |
| BSD-2-Clause | 4 |
| CDLA-Permissive-2.0 | 3 |
| 0BSD | 1 |
| bzip2-1.0.6 | 1 |
| BSL-1.0 | 1 |

### Frontend (JavaScript)

Counted across the production (runtime) dependency closure only; build-time and test tooling are not distributed.

| License | Dependencies |
| --- | ---: |
| MIT | 139 |
| ISC | 18 |
| BSD-3-Clause | 3 |
| Apache-2.0 | 1 |
| 0BSD | 1 |
| Python-2.0 | 1 |
| CC0-1.0 | 1 |
