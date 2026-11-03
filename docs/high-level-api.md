# High-level API and virtual file system

`fengari.api` wraps the C API and `fengari.vfs` exposes the in-memory file
system used by `io`/`os` in browsers. Both are optional: the C API in `lua`
and `lauxlib` remains the source of truth.

```js
const { api, vfs } = require("fengari");
// or: import { api, vfs } from "fengari";
```

TypeScript definitions live in `types/fengari.d.ts`.

## States

```js
const state = api.createState();          // opens the standard libraries
state.run("return 1 + 2");                // 3
state.run("return 'a', 2, true");         // ["a", 2, true]
state.run("return");                      // undefined
state.dostring("x = 5");                  // alias of run
state.dofile("/path/to/chunk.lua");
state.call("add", [2, 3]);                // calls a global
state.close();
```

`createState({ version, openlibs })` selects a version profile (`"5.1"`,
`"5.2"`, `"5.3"`) and can skip `luaL_openlibs`. Errors are `Error` objects
with `luaMessage` and `luaTraceback`.

`run`/`dostring` accept a JS string or a `Uint8Array` and return one value, an
array of values, or `undefined`. `call` accepts a global name or a stack index.

## Compiled chunks

`state.compile(source, chunkname)` returns the binary chunk as a `Uint8Array`:

```js
const chunk = state.compile("return 6 * 7", "=(answer)");
state.run(chunk);                  // 42
```

`run`/`dostring` accept that representation, so hosts can cache compiled
chunks in memory or on disk. Binary chunks are tied to the state's version
profile and should be regenerated when the source or profile changes.

## Values

- `toJS(L, index)` converts nil, booleans, numbers, strings, tables and
  functions. Tables with a `1..n` sequence become arrays; other tables become
  objects. Cycles and nesting deeper than 100 throw.
- `pushJS(L, value)` converts the reverse direction. Arrays become `1..n`
  tables, plain objects become string-keyed tables, functions become C
  functions whose arguments/results are converted recursively, and
  `Uint8Array` becomes a Lua string.

## Promises

```js
state.pushAsyncJS(async (url) => (await fetch(url)).status);
lua.lua_setglobal(state.L, "fetchStatus");

await state.runAsync('return fetchStatus("/data.json")'); // 200
await state.callAsync("someLuaFunction", [1, 2]);
```

`runAsync`/`callAsync` run the chunk in a coroutine. Each `pushAsyncJS`
function returns a Promise; the driver awaits it and resumes the coroutine with
the resolved value. A rejection becomes a Lua error. Plain `run`/`call` remain
synchronous, so async functions only work under the async drivers.

## Async modules

`installAsyncModules` adds a searcher that fetches modules while under
`runAsync`:

```js
state.installAsyncModules({
    base: "/modules/",                  // name -> /modules/name.lua
    map: { alias: "/custom/alias.lua" }, // import-map style overrides
    fetch: async (name, url) => source,  // optional custom fetcher
    js: {
        base: "/modules/",               // name -> /modules/name.js
        extension: ".js",
        format: "cjs",                   // "cjs" or "esm"
        map: {
            cjs: "/modules/mod.js",
            esm: { url: "/modules/mod.mjs", format: "esm" }
        },
        import: (url) => import(url)     // optional custom ESM importer
    }
});

await state.runAsync('return require("alias")');
```

- Lua sources are fetched as text and loaded with `load(source, "@name")`.
- CommonJS is evaluated with `module`/`exports`/`fengari` and its exports are
  converted with `pushJS`; a returned value wins over `module.exports`.
- ES modules use dynamic `import()` (or the `import` option) and expose
  `default` (or the namespace).
- Mounted files and `package.preload` take precedence. XHR is never used when
  `vfs.allowNetwork(false)` is set.

`package.loadlib` is still synchronous.

## Sandbox

```js
const box = api.sandbox({
    instructions: 1e6,   // VM instructions per run
    milliseconds: 100,   // wall clock per run
    memory: 512,         // approximate KB via collectgarbage("count")
    hide: ["io", "os", "package", "debug", "dofile", "loadfile", "require"]
});
box.run("while true do end"); // throws "instruction limit exceeded"
box.close();
```

The defaults hide `io`, `os`, `package`, `debug`, `dofile`, `loadfile` and
`require`. `load` remains available (it only compiles strings). The memory
limit is approximate, not an OS-level cap, and is reset (with a collection)
before each run.

## Worker bridge

For a worker that needs **synchronous** calls into the host:

```js
// host (page)
const shared = new SharedArrayBuffer(65536);
const channel = new MessageChannel();
api.serveSyncBridge(channel.port1, shared, async (op, a, b) => a + b);
worker.postMessage({ shared, port: channel.port2 }, [channel.port2]);

// worker
const bridge = api.createSyncBridge(port, shared);
state.pushJS(bridge.call);
lua.lua_setglobal(state.L, "hostCall");
state.run('return hostCall("add", 2, 3)'); // 5
```

The worker blocks in `Atomics.wait`; the host handler may be async. Requests
and responses are JSON, one call at a time, and limited by the
`SharedArrayBuffer` size. SharedArrayBuffer requires cross-origin isolation
(COOP/COEP). For non-blocking calls use `pushAsyncJS` + `postMessage`.

## Virtual file system (`vfs`)

```js
vfs.mount("/main.lua", "return 42");
vfs.mount("/assets/data.bin", new Uint8Array([1, 2, 3]));
vfs.readFile("/main.lua");            // Uint8Array | null
vfs.listFiles();                      // ["/assets/data.bin", "/main.lua"]
vfs.snapshot();                       // [{ path, data }, ...]
vfs.restore(snapshot);
vfs.unmount("/main.lua");
vfs.reset();

vfs.setStdin("line one\nline two\n");
vfs.setStdout((line) => console.log(line));  // returns the previous handler
vfs.setStderr((line) => console.error(line));
vfs.flush();                                  // flush stdout/stderr buffers
vfs.setEnv("HOME", "/home/lua");
```

`io`, `os.remove/rename/tmpname/getenv`, `loadfile`/`dofile` and `require`
use this file system when there is no Node `process`. Relative paths resolve
against `/`; temporary files live under `/tmp`.

Network access for `require`/`loadfile` can be disabled:

```js
vfs.allowNetwork(false); // only mounted files are visible
```

## Persistence

Snapshots are plain `{ path, data }` entries; the host decides when to persist.

```js
// localStorage (synchronous, small files)
vfs.saveToStorage("app-fs");
vfs.loadFromStorage("app-fs");
vfs.clearStorage("app-fs");

// IndexedDB (Promises, larger files)
await vfs.saveToIndexedDB("app-fs");
await vfs.loadFromIndexedDB("app-fs");
await vfs.clearFromIndexedDB("app-fs");

// OPFS snapshot through an existing directory handle
await vfs.saveToOPFS(directoryHandle, "app-fs");
await vfs.loadFromOPFS(directoryHandle, "app-fs");
await vfs.clearFromOPFS(directoryHandle, "app-fs");
```

## Direct OPFS (workers)

`FileSystemSyncAccessHandle` is only available in workers, so direct OPFS
mounting happens there:

```js
const root = await navigator.storage.getDirectory();
const dir = await root.getDirectoryHandle("game", { create: true });
const mounted = await vfs.mountOPFS(dir, { files: ["saves/new.txt"] });
// io.open("/saves/new.txt", "w") now writes to OPFS
vfs.unmountOPFS(); // flush + close
```

`mountOPFS` walks subdirectories and opens one synchronous handle per file;
`files` pre-creates paths that do not exist yet. Files created *during* Lua
that were not pre-created fall back to the in-memory file system. The main
thread must use the snapshot helpers instead.

## Environment

- `vfs.useMemory()` / `vfs.useNode()` switch the backend (Node hosts/tests).
- `vfs.current()` returns `"node"`, `"memory"` or `"opfs"`.
- `vfs.networkEnabled()` reports the XHR fallback state.
