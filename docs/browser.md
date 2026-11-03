# Browser support

Fengari runs in browsers without Node APIs. `io`, the file-related parts of
`os`, `loadfile`/`dofile`, `require` and the high-level API work on top of an
in-memory file system (`vfs`); Workers, OPFS, IndexedDB and
`SharedArrayBuffer` are supported where the platform provides them.

## Bundle

```bash
pnpm build
```

generates:

- `dist/fengari.js` — self-contained IIFE, exposes `window.fengari`;
  stubs Node built-ins.
- `dist/fengari.js.map` — source map with `sourcesContent`.
- `dist/fengari.min.js` — same bundle with comments and indentation removed
  (no identifier mangling), about 30 % smaller.

The bundle is built again by `prepack`, so `npm pack`/publish ships all three
files. `window.fengari` has the same exports as the CommonJS package
(`lua`, `lauxlib`, `lualib`, `versions`, `vfs`, `api`, string helpers).

Use the package entry (`require("fengari")` / `import ... from "fengari"`)
when a bundler resolves CommonJS; `dist/fengari.js` is for script tags and
workers.

## What works without Node

- `io`: `open`, `read`, `write`, `lines`, `input`, `output`, `tmpfile`,
  `seek`, `setvbuf`, `flush`, `close`, `type`, `stdin/stdout/stderr`.
- `os`: `date`, `time`, `difftime`, `clock`, `setlocale`, `remove`, `rename`,
  `tmpname`, `getenv` (host-provided environment), `execute`/`exit` fail with
  a clear error.
- `loadfile`, `dofile`, `require` for mounted `.lua`/`.js` modules.
- `debug.debug` through `window.prompt` (a host reader can be installed with
  `lualib.lua_setdebugreader`).
- `api.run/dostring/call`, async predicates, sandbox, worker bridge.

`io.popen` is unavailable (no processes); `os.execute` returns
`nil, message, errno` and `os.exit` raises an error.

## Modules

Mounted modules load without network:

```js
vfs.mount("/modules/plugin.lua", "return { value = 1 }");
vfs.mount("/modules/plugin.js",
    "return { luaopen_plugin: function(L) { fengari.lua.lua_pushinteger(L, 2); return 1; } };");
```

`require` uses `package.path`/`package.jspath`; with
`vfs.allowNetwork(false)` the synchronous XHR fallback is disabled. Async
loading uses `api.installAsyncModules` under `runAsync` and supports Lua,
CommonJS and ES modules with import-map style overrides (see
[the high-level API guide](high-level-api.md#async-modules)).

## Persistence

| Storage | API | Sync inside Lua | Notes |
| --- | --- | --- | --- |
| memory | default VFS | yes | lost on reload |
| localStorage | `vfs.saveToStorage` / `loadFromStorage` | host-driven | small, synchronous |
| IndexedDB | `vfs.saveToIndexedDB` / `loadFromIndexedDB` | host-driven (Promises) | larger snapshots |
| OPFS snapshot | `vfs.saveToOPFS` / `loadFromOPFS` | host-driven (Promises) | snapshot file via `createWritable` |
| OPFS direct | `vfs.mountOPFS` / `unmountOPFS` | yes after async mount | workers only |

Direct OPFS opens synchronous access handles for files that exist at mount
time, or for paths listed in `{ files: [...] }`. Files created by Lua later
stay in memory; the main thread cannot use sync access handles, so it uses the
snapshot helpers.

## Workers

The bundle can be loaded with `importScripts()` in a dedicated worker. The
VFS and `io`/`os` work there; `print`/`io.write` go to the worker console or
to the handlers installed with `vfs.setStdout`/`setStderr`.

Non-blocking calls can use `pushAsyncJS` + `postMessage`. For blocking calls
the worker can use `api.createSyncBridge(port, shared)` and the host
`api.serveSyncBridge(port, shared, handler)`: the worker waits with
`Atomics.wait` while the host answers. This requires `SharedArrayBuffer`, which
needs cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`).

## Tests

`pnpm test:browser` builds the bundle, serves it from `127.0.0.1`, launches
**Brave headless** with the Chrome DevTools Protocol and runs the browser
suite. It falls back to Chromium/Chrome if Brave is not installed; set
`BRAVE_BIN` to choose a binary. `--keep` preserves the temporary profile.

The suite (19 checks) covers:

- `process`-less environment and the VFS
- `io`/`os` operations, `tmpfile`, `lines`, `seek`, `rename`, `remove`
- mounted `require`/`dofile` with network disabled (no XHR)
- async `require`, CommonJS and ES modules, import maps
- `loadFromURL`
- localStorage, IndexedDB, OPFS snapshots, direct/nested OPFS
- `SharedArrayBuffer`/cross-origin isolation
- a real Web Worker and worker RPC (async and blocking SAB)
- `debug.debug`, stdout handlers, `os.execute`/`os.exit`/`io.popen` failures
- the minified bundle and source map
- sandbox instruction/memory/time limits

CI runs the same script in the `browser` job, which installs Brave (continuing
if the install fails, so the preinstalled Chrome is used).

## Limitations

- No async `package.loadlib`; use `require` from `installAsyncModules`.
- Direct OPFS is worker-only and cannot create arbitrary files synchronously.
- The minified bundle does not mangle identifiers or eliminate code.
- The suite runs on Brave/Chromium only; there is no Firefox, Safari or mobile
  job.
- `SharedArrayBuffer` is subject to the page's cross-origin isolation policy.
- `os.execute`, `os.exit` and `io.popen` need a process API and are absent.
