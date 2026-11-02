# AGENTS.md

Fengari is a port of the Lua 5.3 VM, parser and standard libraries to ES6 JavaScript (CommonJS). This repository is the core library only: browser bundles live in `fengari-web`, the CLI in `fengari-node-cli`. `src/` ships as-is; there is no build, bundle, transpile or typecheck step.

## Run

- This machine has no `npm`, `yarn` or `corepack`; use **pnpm** from the repo root.
- `pnpm install`, then `pnpm lint` (`eslint src/ test/`), then `pnpm test` (Jest: 40 suites, ~610 tests, ~20 s).
- `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS` for `@parcel/watcher`; dependencies are still installed. Ignore it unless you need Jest watch mode.
- Single file: `pnpm test test/lvm.test.js`. Single test: `pnpm test test/lvm.test.js -t "MOVE"`. Do **not** put `--` before `-t`; Jest treats it as a filename pattern.
- `test/manual-tests/debug-cli.js` is not run by Jest (it needs an interactive stdin).
- CI (`.github/workflows/ci.yaml`) uses **yarn** on Node 20/22/24/25: `yarn lint` then `yarn test --maxWorkers=$(nproc)` with `FENGARICONF='{"LUAI_MAXSTACK":100000}'`. Keep `package.json`/`yarn.lock` consistent; `pnpm-lock.yaml` is local-only.

## Layout and flow

- `src/` mirrors the Lua 5.3 C sources file by file: `llex` → `lparser` → `lcode` (compile), `ldo` (calls/stack/errors), `lvm` (bytecode loop), `lobject`/`lstring`/`ltable`/`ltm` (values/strings/tables/metamethods), and `lapi`/`lauxlib`/`lualib` (C API layers).
- `src/fengari.js` is the package entry (`main`); it re-exports `luaconf`, `lua`, `lauxlib`, `lualib`, `versions`, `vfs`, `api` and the string helpers. `src/fengari.mjs` is the ES module wrapper, `types/fengari.d.ts` the type definitions, `src/fengari-api.js` the high-level `createState`/`run`/`runAsync`/`call`/`sandbox` helpers and `dist/fengari.js`/`dist/fengari.min.js` (+ source map) the generated browser IIFEs (`pnpm build`). Internal code requires the narrow module (`require("../src/lua.js")`), never the root bundle.
- `src/lfs.js` is the synchronous platform layer behind `io`/`os`: Node's `fs`/`tmp`/`child_process`, or an in-memory file system when `process` is absent. Its `vfs` export is the host API to mount, read, snapshot and restore files, stub stdin/stdout/env and persist via localStorage or IndexedDB.
- `lua_*`/`luaL_*` names and constants are intentional 1:1 ports of `lua.h`/`lauxlib.h`; follow that naming. New constants go in `defs.js` and are re-exported by `lua.js`.
- `src/linit.js` is the only place that registers standard libraries (`luaL_openlibs`); it then applies the selected version profile's `openlibs` hook. `io` is always registered; `src/lfs.js` selects the real file system under Node and an in-memory one elsewhere, and `os`, `package`, `debug` and the base library select their browser branches with `lfs.is_node` (not `typeof process`, which a bundler can fake).
- `src/lgc.js` implements weak tables, finalizers and a mark/sweep with incremental marking; `src/versions.js` plus `src/versions/` select Lua 5.1/5.2/5.3 library profiles (`src/lbitlib.js` provides `bit32` for 5.2).
- `test/test-suite/` is the official Lua test suite adapted to Jest; `test/test-suite/ltests.js` implements the C `T` test library. Remaining skips are mostly API harness/memory-limit tests, external fixtures and locale-specific tests.
- `bench/` holds the Lua benchmarks, `scripts/diff-puc.js` the differential corpus under `test/differential/`, and `scripts/fuzz.js` the parser/undump fuzzer. CI runs the differential tests, benchmarks, a bounded fuzz and the browser suite (19 CDP tests) in a job that installs Brave; `pnpm test` only runs the bounded fuzz and differential tests (the latter skips without a Lua binary). Browser tests use the Chrome DevTools Protocol (`scripts/browser-test.js`), not Playwright, and cover async Lua/CommonJS/ES modules, a blocking SAB bridge, worker RPC, direct/nested OPFS, debug.debug and the minified bundle.
- `docs/api.md` is generated from the public `module.exports` declarations by `scripts/generate-api-docs.js`; run `pnpm docs:api` after changing signatures, and `pnpm docs:check` (also part of `pnpm check`) verifies it. `docs/migrating-from-c.md` is hand-written.
- Core semantics are Lua 5.3 with **32-bit integers** (`LUA_MAXINTEGER = 2147483647` in `luaconf.js`). The bundled 5.1/5.2 profiles adjust the library surface, not the parser or number model.

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
