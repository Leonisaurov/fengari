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
- `src/fengari.js` is the package entry (`main`); it re-exports `luaconf`, `lua`, `lauxlib`, `lualib` and the string helpers. Internal code requires the narrow module (`require("../src/lua.js")`), never the root bundle.
- `lua_*`/`luaL_*` names and constants are intentional 1:1 ports of `lua.h`/`lauxlib.h`; follow that naming. New constants go in `defs.js` and are re-exported by `lua.js`.
- `src/linit.js` is the only place that registers standard libraries (`luaL_openlibs`). `io` is loaded only when `process` exists; `os`, `package` and `debug` have browser branches selected with `typeof process === "undefined"`.
- `test/test-suite/` is the official Lua test suite adapted to Jest; `test/test-suite/ltests.js` implements the C `T` test library. Most skips are GC, `io.read` or memory-limit tests.
- Semantics are Lua 5.3 with **32-bit integers** (`LUA_MAXINTEGER = 2147483647` in `luaconf.js`).

## Gotchas

- **Lua strings are bytes, not JS strings.** They are `Uint8Array`; convert with `to_luastring` before `luaL_loadstring`/`lua_pushstring`, and read with `lua_tojsstring`/`to_jsstring`. `lua_pushliteral` is the exception that takes a JS string.
- `lua_tostring`/`lua_tojsstring` return `null` when the value is not a string or number; check before passing the result to `to_jsstring` (which throws on non-`Uint8Array`).
- Integer arithmetic is 32-bit and wraps; JS `Number` is only the float type. Do not introduce `BigInt` implicitly.
- `luaconf.js` reads `process.env.FENGARICONF` as JSON **at require time**; set it before importing fengari (CI sets `LUAI_MAXSTACK`).
- Lua errors unwind by throwing `L.errorJmp` (see `luaD_throw` in `ldo.js`). Use `lua_pcall`/`lua_pcallk` at JS boundaries; a bare `try/catch` around `lua_call` does not follow the Lua error protocol.
- `collectgarbage`/`lua_gc` throws "lua_gc not implemented"; weak tables (`__mode`) and `__gc` are not implemented.
- `debug.debug()` depends on `readline-sync` and a Node TTY.
- `io.*` is partial (`io.read`, `io.lines`, `io.open`, …) and Node-only. In browsers `require`/`package.loadlib` use synchronous XHR.
- `string.format` does not implement precision modifiers for `%a`/`%A`.
- Tests reach into VM internals, e.g. `L.stack.slice(L.top - n, L.top).map(e => e.value)`; preserve `TValue.value` and the stack layout when refactoring.
- `eslint.config.mjs` imports `globals`, so it must stay a direct devDependency (it was missing upstream). Lint enforces 4 spaces, semicolons and LF line endings.
