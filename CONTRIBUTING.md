# Contributing to Fengari

Thanks for helping! Fengari is a byte-faithful port of the Lua 5.3 VM, parser
and standard libraries to ES6 JavaScript. Small, focused changes with tests are
the easiest to review.

## Before you start

- Read `AGENTS.md` for the repository layout and the non-obvious rules
  (Lua strings are `Uint8Array`, integers are 32-bit, errors use
  `L.errorJmp`, ...).
- Open an issue for behaviour changes or anything larger than a bug fix, so the
  approach can be agreed first.

## Development

This machine and CI use different package managers:

```sh
# local development
pnpm install        # exits 1 with ERR_PNPM_IGNORED_BUILDS; deps are installed
pnpm lint
pnpm test

# CI uses yarn
yarn --frozen-lockfile
yarn lint
yarn test
```

`package.json`/`yarn.lock` are the published lockfiles. `pnpm-lock.yaml` is
local-only and ignored.

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm test` | Jest suite (59 suites, ~820 tests) |
| `pnpm test test/lvm.test.js -t "MOVE"` | one file / one test |
| `pnpm test:coverage` | coverage with the configured thresholds |
| `pnpm test:diff` | differential corpus against PUC Lua (needs `lua`) |
| `pnpm test:browser` | CDP integration tests (needs Brave/Chrome) |
| `pnpm bench` | Lua benchmarks |
| `pnpm bench:compile` | compile-time benchmark (`node bench/compile.js`) |
| `pnpm bench:startup` | startup and bundle-size benchmark |
| `pnpm fuzz` | parser/undump fuzzer |
| `pnpm build` | regenerate `dist/` |
| `pnpm typecheck` / `pnpm typecheck:js` | declaration / source typecheck |
| `pnpm changelog` | draft a NEWS section from git history |
| `pnpm check` | lint, generated API docs, typechecks and tests |

Do not put `--` before Jest's `-t`; Jest treats it as a filename pattern.

## Tests

- Add a regression test for every bug fix and a positive test for every new
  feature.
- Prefer the existing suites: `test/*.test.js` for units and
  `test/test-suite/` for the official Lua suite.
- Tests may inspect VM internals (`L.stack`, `TValue.value`). Keep that layout
  when refactoring or update the tests in the same commit.
- If you skip a test, add a comment explaining what PUC feature or host
  capability is unavailable.

## Code style

- Run `pnpm lint` before committing. ESLint enforces 4 spaces, semicolons and
  LF line endings.
- Follow the existing `lua_*`/`luaL_*` names and the file-per-C-source layout.
- New constants belong in `src/defs.js` and must be re-exported by `src/lua.js`.
- Keep the browser bundle free of Node-only modules; put platform code behind
  `src/lfs.js`.
- Update `NEWS` for user-visible changes and `AGENTS.md` when commands, layout
  or workflows change.

## Commits and pull requests

- Commit every completed change; do not leave the working tree dirty.
- Use the existing prefixes: `feat:`, `fix:`, `perf:`, `docs:`, `test:`,
  `refactor:` or `chore:`.
- Keep unrelated changes in separate commits.
- Describe the behaviour and the tests in the PR. Link the issue it closes.

## Releasing

1. Update the version in `package.json` (and the matching `yarn.lock` entry).
2. Run `pnpm check`, `pnpm test:diff` and, when possible, `pnpm test:browser`.
3. Run `node scripts/changelog.js --version=X.Y.Z` (or `pnpm changelog`)
   and merge the useful lines into the `unreleased` section of `NEWS`.
4. Commit, tag `vX.Y.Z` and push the tag. `.github/workflows/publish.yml`
   checks that the tag matches `package.json`, runs the full checks and
   publishes to npm with provenance.

By contributing you agree that your contributions are licensed under the MIT
license.
