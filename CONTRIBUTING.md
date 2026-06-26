# Contributing to Arris

Thanks for your interest in improving Arris. This guide covers how to report issues, propose changes, and the licensing terms for contributions.

## Ways to contribute

- **Report a bug or request a feature** by opening an [issue](https://github.com/arrisdb/arris/issues). Include your macOS version, your Arris version (Arris → About), the database engine involved, and clear steps to reproduce.
- **Improve docs** at [docs.arrisdb.app](https://docs.arrisdb.app).
- **Submit code** via a pull request (see below).

## Pull request workflow

1. For anything non-trivial, **open an issue first** so we can agree on direction before you write code.
2. Fork the repo and create a branch off `main` (e.g. `fix-postgres-explain`).
3. Make a focused change. Match the surrounding style and the structure rules the codebase follows.
4. **Add and run tests:**
   - Backend (Rust): `cargo test` from the repo root.
   - Frontend: `cd frontend && npm install && npm test`.
   - Rust dependency changes: also run `cargo deny check` and confirm it passes.
5. Make sure the full relevant suite is green before opening the PR. Do not submit red tests.
6. Open the PR against `main`, describe what changed and why, and link the issue.
7. Confirm the licensing checkbox in the PR template (see Legal below).

## Reporting security issues

Please do not file public issues for security vulnerabilities. Report them privately via [arrisdb.app](https://arrisdb.app) so a fix can ship before disclosure.

## Legal

Arris itself is distributed under the [GNU AGPL-3.0](LICENSE). **All contributions to this repository are made under the [MIT License](https://opensource.org/license/mit).**

### What this means practically

When you open a pull request, the code in that PR is licensed to the project under the MIT License. Once it is merged, it becomes part of Arris and is distributed under the AGPL-3.0. You keep the copyright to your contribution, and your original MIT license still applies to it; the MIT terms only require that the copyright notice be preserved.

### Why this way

MIT is a permissive license, so it grants the project the rights it needs to keep Arris's licensing flexible over time while you keep full copyright to your work. You do not assign copyright or sign anything by hand; opening a pull request and checking the box in the PR template is all that is needed.

By opening a pull request and checking the box in the PR template, you confirm that your contribution is your original work (or that you have the right to submit it) and that you license it to the project under the MIT License.

#### MIT License for contributions

```
Copyright (c) the respective contributor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
