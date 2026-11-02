# AGENTS.md

Fengari is a port of the Lua 5.3 VM, parser and standard libraries to ES6 JavaScript (CommonJS). This repository is the core library plus a generated browser bundle (`dist/`); the CLI lives in `fengari-node-cli` and `fengari-web` provides additional browser integration. `src/` ships as-is: there is no transpile or full-source typecheck step, but `pnpm typecheck` validates the published declarations with a strict consumer, and `pnpm build` bundles `src/` for the browser.

## Run

- This machine has no `npm`, `yarn` or `corepack`; use **pnpm** from the repo root.
- `pnpm install`, then `pnpm lint` (`eslint src/ test/ scripts/`), then `pnpm test` (Jest: 60 suites, ~806 tests, ~16 s).
- On a resource-constrained machine, cap Jest workers: `pnpm exec jest --maxWorkers=2` (or `--runInBand`); avoid running coverage and browser tests concurrently.
- `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS` for `@parcel/watcher`; dependencies are still installed. Ignore it unless you need Jest watch mode.
- Single file: `pnpm test test/lvm.test.js`. Single test: `pnpm test test/lvm.test.js -t "MOVE"`. Do **not** put `--` before `-t`; Jest treats it as a filename pattern.
- `test/manual-tests/debug-cli.js` is not run by Jest (it needs an interactive stdin).
- `pnpm check` runs lint, `docs:check`, `typecheck` and Jest. `pnpm test:diff` needs `lua5.3`/`lua5.4`/`lua` (or `LUA_BIN`); `pnpm test:browser` needs Brave, Chromium or Chrome and runs `scripts/browser-test.js` (`BRAVE_BIN` selects the binary, `--keep` preserves the profile).
- `pnpm build` writes `dist/fengari.js`, `.js.map` and `.min.js`; `prepack` rebuilds them for publishing.
- CI (`.github/workflows/ci.yaml`) uses **yarn** on Node 20/22/24/25/26 with `FENGARICONF='{"LUAI_MAXSTACK":100000}'`; it also runs the differential corpus, benchmarks, fuzzing and a browser job that installs Brave. Keep `package.json`/`yarn.lock` consistent; `pnpm-lock.yaml` is local-only.

## Layout and flow

- `src/` mirrors the Lua 5.3 C sources file by file: `llex` → `lparser` → `lcode` (compile), `ldo` (calls/stack/errors), `lvm` (bytecode loop), `lobject`/`lstring`/`ltable`/`ltm` (values/strings/tables/metamethods), and `lapi`/`lauxlib`/`lualib` (C API layers).
- `src/fengari.js` is the package entry (`main`); it re-exports `luaconf`, `lua`, `lauxlib`, `lualib`, `versions`, `vfs`, `api` and the string helpers. `src/fengari.mjs` is the ES module wrapper, `types/fengari.d.ts` the type definitions, `src/fengari-api.js` the high-level `createState`/`run`/`runAsync`/`call`/`sandbox` helpers and `dist/fengari.js`/`dist/fengari.min.js` (+ source map) the generated browser IIFEs (`pnpm build`). Internal code requires the narrow module (`require("../src/lua.js")`), never the root bundle.
- `src/lfs.js` is the synchronous platform layer behind `io`/`os`: Node's `fs`/`tmp`/`child_process`, or an in-memory file system when `process` is absent. Its `vfs` export is the host API to mount, read, snapshot and restore files, stub stdin/stdout/env and persist via localStorage or IndexedDB.
- `lua_*`/`luaL_*` names and constants are intentional 1:1 ports of `lua.h`/`lauxlib.h`; follow that naming. New constants go in `defs.js` and are re-exported by `lua.js`.
- `src/linit.js` is the only place that registers standard libraries (`luaL_openlibs`); it then applies the selected version profile's `openlibs` hook. `io` is always registered; `src/lfs.js` selects the real file system under Node and an in-memory one elsewhere, and `os`, `package`, `debug` and the base library select their browser branches with `lfs.is_node` (not `typeof process`, which a bundler can fake).
- `src/lgc.js` implements weak tables, finalizers and a mark/sweep with incremental marking; `src/versions.js` plus `src/versions/` select the Lua 5.1/5.2/5.3/5.4 library profiles (`src/lbitlib.js` provides `bit32` for 5.2). `src/lundump_native.js` translates native PUC 5.1/5.2 binary chunks to the internal layout; real fixtures are in `test/fixtures/`.
- `test/test-suite/` is the official Lua test suite adapted to Jest; `test/test-suite/ltests.js` implements the C `T` test library. Remaining skips are documented in `test/test-suite/SKIPS.md` (memory-limit harness and table internals).
- `bench/` holds the Lua benchmarks, `scripts/diff-puc.js` the differential corpus under `test/differential/`, and `scripts/fuzz.js` the parser/undump fuzzer. CI runs the differential tests, benchmarks, a bounded fuzz and the browser suite (19 CDP tests) in a job that installs Brave; `pnpm test` only runs the bounded fuzz and differential tests (the latter skips without a Lua binary). Browser tests use the Chrome DevTools Protocol (`scripts/browser-test.js`), not Playwright, and cover async Lua/CommonJS/ES modules, a blocking SAB bridge, worker RPC, direct/nested OPFS, debug.debug and the minified bundle.
- `docs/api.md` is generated from the public `module.exports` declarations by `scripts/generate-api-docs.js`; run `pnpm docs:api` after changing signatures, and `pnpm docs:check` (also part of `pnpm check`) verifies it. `docs/migrating-from-c.md`, `docs/high-level-api.md` and `docs/browser.md` are hand-written; update them with API/browser changes.
- Core semantics are Lua 5.3 with **32-bit integers** (`LUA_MAXINTEGER = 2147483647` in `luaconf.js`). `FENGARICONF.LUA_INT64=true` selects the opt-in `BigInt` integer mode (`LUA_MAXINTEGER` becomes `9223372036854775807n`, bytecode format byte 1, `lua_int` canonicalizes integer values, formats 0/1 load in either mode when constants fit); dump also carries the profile version byte (0x51/0x52/0x53/0x54) and `lundump` rejects cross-profile chunks. The default remains 32-bit. The bundled 5.1/5.2/5.4 profiles adjust the library surface; 5.1/5.2 also gate the lexer/parser (no `//`/bitwise, `goto` is a name in 5.1) and expose doubles rather than integer-tagged values (`luaO_setint`/`lua_pushinteger`), though registry/constant indices stay integer-tagged internally. The 5.4 profile additionally enables the `<const>`/`<close>` local attributes (opcodes `OP_TBC`/`OP_CLOSE`/`OP_TFORPREP` and `luaF_newtbcupval`/`luaF_close`).

## Gotchas

- **Lua strings are bytes, not JS strings.** They are `Uint8Array`; convert with `to_luastring` before `luaL_loadstring`/`lua_pushstring`, and read with `lua_tojsstring`/`to_jsstring`. `lua_pushliteral` is the exception that takes a JS string.
- `lua_tostring`/`lua_tojsstring` return `null` when the value is not a string or number; check before passing the result to `to_jsstring` (which throws on non-`Uint8Array`).
- Integer arithmetic is 32-bit and wraps; JS `Number` is only the float type. Do not introduce `BigInt` implicitly.
- `luaconf.js` reads `process.env.FENGARICONF` as JSON **at require time**; set it before importing fengari (CI sets `LUAI_MAXSTACK`).
- Lua errors unwind by throwing `L.errorJmp` (see `luaD_throw` in `ldo.js`). Use `lua_pcall`/`lua_pcallk` at JS boundaries; a bare `try/catch` around `lua_call` does not follow the Lua error protocol.
- `collectgarbage`/`lua_gc` is implemented (`collect`, `stop`, `restart`, `count`, `step`, `setpause`, `setstepmul`, `isrunning`); weak tables (`__mode`) and `__gc` are supported, but memory is accounted with per-type estimates.
- `debug.debug()` depends on `readline-sync` and a Node TTY.
- `io.*` is complete for Lua 5.3 on Node. Without `process` it runs on the in-memory VFS in `src/lfs.js` (mounted and read through the exported `vfs` helpers), as do `os.remove/rename/tmpname/getenv` and `loadfile`/`require` before falling back to synchronous XHR. `io.popen` buffers instead of streaming, `setvbuf` drives a JS write buffer that is flushed on `flush`/`close`/`seek` or when full, and `os.execute`/`os.exit` need a process API.
- `string.format` does not implement precision modifiers for `%a`/`%A`.
- Tests reach into VM internals, e.g. `L.stack.slice(L.top - n, L.top).map(e => e.value)`; preserve `TValue.value` and the stack layout when refactoring.
- `eslint.config.mjs` imports `globals`, so it must stay a direct devDependency (it was missing upstream). Lint enforces 4 spaces, semicolons and LF line endings.

## Commits

- Commit every completed change; do not leave the working tree dirty when a task is done.
- Include the `AGENTS.md` update in the same commit when the workflow, layout or commands change.
- Keep unrelated work in separate commits and use the existing `feat:` / `fix:` / `docs:` / `test:` prefixes.
