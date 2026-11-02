[![Build Status](https://github.com/fengari-lua/fengari/actions/workflows/ci.yaml/badge.svg)](https://github.com/fengari-lua/fengari/actions/workflows/ci.yaml?query=event%3Apush)
[![npm](https://img.shields.io/npm/v/fengari.svg)](https://npmjs.com/package/fengari)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![#fengari on libera.chat](https://img.shields.io/badge/chat-%23fengari-brightgreen)](https://web.libera.chat/?channels=#fengari)

<p align="center">
    <img src="https://github.com/fengari-lua/fengari/raw/master/logo.png" alt="Fengari" width="304" height="304">
</p>


# Fengari

🌙 φεγγάρι - The Lua VM written in JS ES6 for Node and the browser

This repository contains the core fengari code (which is a port of the Lua C library) which includes parser, virtual machine and base libraries.
However it is rare to use this repository directly.

- To use fengari in a web browser as easily as you might use JavaScript, see [fengari-web](https://github.com/fengari-lua/fengari-web)
- [fengari-interop](https://github.com/fengari-lua/fengari-interop) is a lua library that makes interoperating with JavaScript objects simple, it is already included in fengari-web.
- For a clone of the `lua` command line tool, but running under node.js, see [fengari-node-cli](https://github.com/fengari-lua/fengari-node-cli)
- API reference: [docs/api.md](docs/api.md) (generated from the source tree)
- Migrating an embedding from Lua C: [docs/migrating-from-c.md](docs/migrating-from-c.md)

### The JS API

Once you've loaded fengari, you can use the JS API:

```js
const luaconf  = fengari.luaconf;
const lua      = fengari.lua;
const lauxlib  = fengari.lauxlib;
const lualib   = fengari.lualib;

const L = lauxlib.luaL_newstate();

lualib.luaL_openlibs(L);

lua.lua_pushliteral(L, "hello world!");
```

The JS API is exactly the same as the C API so `fengari.lua` exposes the same constants and functions as `lua.h`, `fengari.lauxlib` the same as `lauxlib.h` and `fengari.lualib` the same as `lualib.h`. If you're unfamiliar with the C API, you can take a look at [the manual](http://www.lua.org/manual/5.3/manual.html#4).


## Semantics

Fengari implements Lua 5.3 semantics and will hopefully follow future Lua releases. If you find any noticeable difference between Fengari and Lua's behaviours, please [report it](https://github.com/fengari-lua/fengari/issues).

### Strings

Lua strings are 8-bits clean and can embed `\0`. Which means that invalid UTF-8/16 strings are valid Lua strings. Lua functions like `string.dump` even use strings as a way of storing binary data.

To address that issue, Fengari uses [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) objects containing the raw bytes to implement lua strings. To push a JS string on the stack you can use `lua_pushliteral` which will convert it to an array of bytes before pushing it. To get a Lua string on the stack as a JS string you can use `lua_tojsstring` which will attempt to convert it to a UTF-16 JS string. The latter won't give you what you expect if the Lua string is not a valid UTF-16 sequence. You can also convert strings with `luastring_of`, `to_luastring`, `to_jsstring` and `to_uristring`.


### Integers

The JS number type is always a double, and hence cannot accurately represent integers with more than 53 bits. As such, we've taken the route of a rarely used define (`LUA_INT_TYPE=LUA_INT_LONG`) in the PUC-Rio sources, where floats are doubles, but integers are 32 bits.


### `require` and `package.loadlib`

In the browser `require` and `package.loadlib` first look for files mounted in the virtual file system (see below) and otherwise try to find a file by making synchronous XHR requests.

`require` has been extended to allow searchers to yield.


### Browser file system (`vfs`)

Browsers have no synchronous file system, so when there is no Node `process` the `io` library and the file functions of `os` (`remove`, `rename`, `tmpname`, `getenv`) run on an in-memory file system instead of being absent. Hosts seed it before running Lua and can read or persist the results afterwards:

```js
const { vfs } = require("fengari");

vfs.mount("/main.lua", "print('hello from a mounted chunk')");
vfs.mount("/assets/data.bin", new Uint8Array([1, 2, 3]));
vfs.setStdout((line) => console.log("lua:", line));
vfs.setStderr((line) => console.error("lua:", line));
vfs.setStdin("line one\nline two\n");
vfs.setEnv("HOME", "/home/lua");

// ... run Lua: io.open/read/write/lines/seek, dofile/require, os.remove ...

const files = vfs.listFiles();     // ["/assets/data.bin", "/main.lua"]
const data = vfs.readFile("/main.lua");
const snapshot = vfs.snapshot();   // [{ path, data }, ...] -> persist it yourself
```

Relative paths resolve against the virtual root (`/`). `io.tmpfile` and `os.tmpname` use `/tmp`. Because the file system is memory only, persistence must be done by the host: read `snapshot()` after a run and `restore()` it (or `mount()` the individual files) in the next one. `vfs.flush()` emits any buffered `io.stdout`/`io.stderr` output. While the memory backend is active, `os.exit`, `os.execute` and `io.popen` are disabled, even under Node.

In Node the real file system is used by default; `vfs.useMemory()` switches a Node host (or a test) to the same in-memory file system, and `vfs.useNode()` switches back. `vfs.current()` returns `"node"`, `"memory"` or `"opfs"`.

See [docs/browser.md](docs/browser.md) for the browser bundle, workers, OPFS, persistence and the CDP test suite, and [docs/high-level-api.md](docs/high-level-api.md) for the full `api`/`vfs` reference.

If the host has a synchronous `localStorage`, `vfs.saveToStorage(key)` serializes the current files (base64) and `vfs.loadFromStorage(key)` restores them; `vfs.clearStorage(key)` removes the entry. For larger data, `vfs.saveToIndexedDB(key)` / `loadFromIndexedDB(key)` / `clearFromIndexedDB(key)` use an IndexedDB database named `fengari-vfs`. With an OPFS `FileSystemDirectoryHandle`, `vfs.saveToOPFS(dir, key)` / `loadFromOPFS(dir, key)` / `clearFromOPFS(dir, key)` persist snapshots through `createWritable()`.

In a **worker**, `await vfs.mountOPFS(dir)` mounts the directory (recursively) as the live file system using synchronous access handles, so `io.open/read/write/seek` work as usual; `vfs.unmountOPFS()` flushes and closes them. Pass `{ files: ["nested/new.txt"] }` to create and open files that do not exist yet. Only files present at mount time (or listed in `files`) are OPFS-backed; paths created later during Lua use the in-memory file system. `createSyncAccessHandle` is worker-only, so the main thread must use the snapshot helpers.

`require` also checks the VFS for both Lua and JS modules, so mounted `.lua` and `.js` files load without XHR. Call `vfs.allowNetwork(false)` to forbid the synchronous XHR fallback entirely; `readable`/`loadfile`/`require` then only see the VFS. For asynchronous module loading, fetch the source first and mount it:

```js
await vfs.loadFromURL("/modules/plugin.lua", "/plugins/plugin.lua");
// now require("plugin") / dofile("/plugins/plugin.lua") work synchronously
```


### Browser bundle and tests

`pnpm build` generates `dist/fengari.js` (with `dist/fengari.js.map`) and `dist/fengari.min.js`, a self-contained IIFE that exposes the package as `window.fengari` (it includes `sprintf-js` and stubs Node-only modules). The `.min` file strips comments and indentation (no identifier mangling) and is built on `pnpm pack` as well, so the tarball ships both.

`pnpm test:browser` runs the browser suite without Playwright: it serves the bundle from a local HTTP server, launches **Brave in headless mode** through the Chrome DevTools Protocol (falling back to Chromium/Chrome if Brave is not installed) and checks the VFS, mounted `require`/`dofile`, async `require`, CommonJS/ES modules with import maps, localStorage, IndexedDB, OPFS snapshots, direct/nested OPFS in a worker, SharedArrayBuffer, a real Web Worker (async RPC and a blocking SAB bridge), `debug.debug`, the minified bundle/source map, stdout handlers and the sandbox. Set `BRAVE_BIN` to point at a specific Brave build.

CI runs the same suite. The XHR path can be disabled with `vfs.allowNetwork(false)` for a VFS-only environment.

### High-level API and sandbox

`api` wraps the common flows so hosts do not need to manage the stack (full reference: [docs/high-level-api.md](docs/high-level-api.md)):

```js
const { api } = require("fengari");

const state = api.createState();
state.run("return 1 + 2");                 // 3
state.run("function add(a, b) return a + b end");
state.call("add", [2, 3]);                 // 5
state.close();

const box = api.sandbox({ instructions: 1e6, milliseconds: 100 });
box.run("while true do end");              // throws "instruction limit exceeded"
```

`run`/`dostring` return one value, an array of values, or `undefined`; errors are `Error` objects with `luaMessage` and `luaTraceback`. `toJS`/`pushJS` convert tables, arrays, objects and functions. Async JS functions are supported with coroutines:

```js
state.pushAsyncJS(async (url) => (await fetch(url)).status);
lua.lua_setglobal(state.L, "fetchStatus");
await state.runAsync('return fetchStatus("/data.json")');  // 200
```

`pushAsyncJS` must be called from code driven by `runAsync`/`callAsync`; the driver awaits each Promise and resumes the coroutine. `installAsyncModules` adds a searcher that fetches missing Lua modules through an async function while under `runAsync`, with an import-map-like option:

```js
state.installAsyncModules({
    base: "/modules/",                       // name -> /modules/name.lua
    map: { alias: "/custom/alias.lua" },      // explicit overrides
    js: {                                     // CommonJS or ES modules
        map: {
            cjs: "/modules/mod.js",
            esm: { url: "/modules/mod.mjs", format: "esm" }
        }
    }
});
await state.runAsync('return require("alias")');
```

For a worker that needs to call the host **synchronously**, `api.createSyncBridge(port, sab)` returns a blocking `call(op, ...args)` for the worker and `api.serveSyncBridge(port, sab, handler)` serves it on the host; the worker waits with `Atomics.wait` and the host may answer asynchronously. This requires a `SharedArrayBuffer` (cross-origin isolation).

The sandbox removes `io`, `os`, `package`, `debug`, `dofile`, `loadfile` and `require` by default (configurable with `hide`) and enforces instruction, wall-clock and approximate memory limits (`instructions`, `milliseconds`, `memory` in KB) with a count hook.

The package also ships ES module bindings (`import { lua, lauxlib, api } from "fengari"`) and TypeScript definitions (`types/fengari.d.ts`).


### Weak tables and finalizers

Weak tables (`__mode` = `"k"`, `"v"` or `"kv"`, including ephemerons) and `__gc` finalizers are implemented. Because JavaScript's collector cannot expose Lua liveness synchronously, Fengari runs a mark/sweep pass over the Lua object graph. A full cycle runs on `collectgarbage("collect")` and when the state is closed; `collectgarbage("step")` marks in bounded batches, re-scanning roots/upvalues/stacks between steps and using write barriers for table, metatable and uservalue writes, then clears weak entries and runs finalizers in bounded batches. Only the ephemeron fixpoint is atomic. Automatic cycles also run after an allocation budget when weak tables or pending finalizers exist (`setpause` scales the budget). Only values reachable from the Lua state count as live, so host-held values must be anchored in the registry or on the stack, as with C pointers in PUC Lua. `collectgarbage("count")` reports an estimate of the live Lua objects, not the JavaScript heap.


### _Missing_ features

- `lua_gc`/`collectgarbage`: the API is implemented on top of a Lua-side mark/sweep. `collect` runs a full cycle, `step` spreads marking, weak clearing and finalization over several calls, and `count` reports the approximate size of live Lua objects (not the JS heap). Weak tables and pending finalizers trigger automatic cycles after an allocation budget, controlled by `setpause`; `setstepmul` controls the work done per step. A full `collect` also asks the host JS collector to run when it exposes `gc` (e.g. Node with `--expose-gc`).
- The following functions need a process API and fail with a clear error (or return `nil`, a message and `errno`) elsewhere:
    - `os.execute`
    - `os.exit`
    - `io.popen`
- `debug.debug()` reads from a Node TTY through `readline-sync` or from `window.prompt` in browsers. Web workers and embedders can install a reader with `lualib.lua_setdebugreader(fn)`; without one it raises a Lua error.


### _Differences_

- `package.jspath` instead of `package.cpath`
- `LUA_JSPATH_DEFAULT` instead of `LUA_CPATH_DEFAULT` (and contains .js extensions rather than .so or .dll extensions)
- `lua_tointegerx` and `lua_tonumberx` do not have out-parameters indicating conversion success. Instead, ``false`` is returned when conversion fails.
- `luaL_execresult` takes an extra argument: an error object. The error object should have fields `status`, `signal` and `errno`.
- `luaL_fileresult` takes an extra argument: an error object. The error object should have a field `errno`.


### Configuring

Some luaconf options can be chosen at library load time. Fengari looks for `process.env.FENGARICONF` and if it exists, parses it as a JSON string. `LUA_VERSION` (for example `{"LUA_VERSION":"5.2"}`) selects the default implementation profile. `LUA_INT64` (for example `{"LUA_INT64":true}`) switches Lua integers to `BigInt` and writes bytecode with format byte `1`; the default remains 32-bit integers and format `0`. This mode covers literals, arithmetic, comparisons, numeric `for`, table keys, `tostring`/`tonumber`, `math.*`, `string.pack/unpack` (`i8`/`I8`), `string.format`, the `table`/`os` integer paths and dump/undump. Bytecode formats 0 and 1 can be loaded in either mode when their constants fit; otherwise loading fails with an explicit error.


## Lua versions

Fengari ships a registry of version implementations (`versions`), with bundled profiles for Lua 5.1, 5.2, 5.3 and the Lua 5.4 library surface:

```js
const { lauxlib, lualib, versions } = require("fengari");

const L = lauxlib.luaL_newstate("5.2");  // omit to use the default
lualib.luaL_openlibs(L);

versions.list();          // ["5.1", "5.2", "5.3", "5.4"]
versions.getDefault();    // "5.3" unless FENGARICONF.LUA_VERSION says otherwise
versions.setDefault("5.2");
versions.features(L);     // { integers, bitwise, goto, env, utf8, bit32, ... }
```

A version module is an object with `name`, `version` (`{major, minor, release, num, string}`), `features`, and optional `openlibs(L)` and `loadbufferx(L, buff, size, name, mode)` hooks. `versions.register(impl)` adds a custom implementation.

The bundled profiles change both the library surface and the accepted syntax: 5.2 installs `bit32`, rejects 5.3 `//`/bitwise operators and numeric literals such as `2147483647 + 1` become floats, while keeping `goto`/labels; 5.1 adds `unpack`, `loadstring`, `getfenv`/`setfenv`, `module`, `package.seeall`, `newproxy`, `table.setn`, `table.maxn`, `string.gfind`, `package.loaders` and the deprecated `math.*` helpers, treats `goto` as a regular name, rejects labels and the same 5.3 operators, and its `load` accepts only a reader function (`loadstring` handles strings); `os.exit` accepts a boolean from 5.2 onward. 5.4 adds `coroutine.close`, `warn`, the 5.4 `math.random`/`randomseed` API (xoshiro, per-state seeds) and the `<const>`/`<close>` local attributes with `__close` finalization, including the generic-for closing value, yielding `__close` on normal unwinding and during `pcall`/`xpcall` error recovery, close errors replacing the original error, and deferred closing through `coroutine.close`; 64-bit integers are available separately through `FENGARICONF.LUA_INT64`. In 5.1/5.2, Lua-visible numbers no longer use the integer subtype: literals, `tonumber`, lengths, `string.byte`, `math.floor`, table keys and loop values are doubles. The internal state still uses integer-tagged values for registry indices and compiler constants. `string.dump` writes the profile's version byte (0x51/0x52/0x53/0x54) and `lundump`/`loadbufferx` reject chunks from another profile. PUC Lua 5.1/5.2 binary chunks are loaded natively and translated to the internal 5.3 opcode layout (`src/lundump_native.js`); 5.2 is an opcode remap, while 5.1 rewrites globals to `_ENV`, consumes CLOSURE descriptors, expands TFORLOOP and remaps jumps. The internal state still uses integer tags for registry indices/constants. The 5.1 `setfenv`/`module`/`package.seeall` implementation uses the 5.3 `_ENV` upvalue, so functions that share an upvalue also share their environment and a function with no `_ENV` upvalue cannot be changed; 5.2 does not expose those functions (it uses `_ENV` directly). Locale support covers the decimal separator only (collation and character classes remain C-only).


## Extensions

### `dv = lua_todataview(L, idx)`

Equivalent to `lua_tolstring` but returns a [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) instead of a string.


### `lua_pushjsfunction(L, func)`

Alias for `lua_pushcfunction`.


### `lua_pushjsclosure(L, func, n)`

Alias for `lua_pushcclosure`.


### `lua_atnativeerror(L, func)`

Sets a function to be called if a native JavaScript error is thrown across a lua pcall.
The function will be run as if it were a message handler (see https://www.lua.org/manual/5.3/manual.html#2.3).
The current message handler will be run after the native error handler returns.


### `b = lua_isproxy(p, L)`

Returns a boolean `b` indicating whether `p` is a proxy (See `lua_toproxy`).
If `L` is non-null, only returns `true` if `p` belongs to the same global state.


### `p = lua_toproxy(L, idx)`

Returns a JavaScript object `p` that holds a reference to the lua value at the stack index `idx`.
This object can be called with a lua_State to push the value onto that state's stack.

This example would be an inefficient way to write `lua_pushvalue(L, 1)`:

```js
var p = lua_toproxy(L, 1);
p(L);
```


### `fengari` library

A library containing metadata about the fengari release.

  - `AUTHORS`
  - `COPYRIGHT`
  - `RELEASE`
  - `VERSION`
  - `VERSION_MAJOR`
  - `VERSION_MINOR`
  - `VERSION_NUM`
  - `VERSION_RELEASE`

This library is automatically loaded by `luaL_openlibs` into the global `"fengari"`.


## NYI

- `io.popen`, `os.execute` and `os.exit` need a process API and are not
  available in the browser.
- The browser file system is in memory by default; persistence is explicit
  through localStorage, IndexedDB or OPFS snapshots, or direct OPFS in a
  worker (`vfs.mountOPFS`).
- `io.popen()`: commands run to completion synchronously; output (read mode)
  and input (write mode) are buffered instead of streamed.
- In the browser, `require` uses the VFS for mounted modules and falls back to
  synchronous XHR for URLs unless `vfs.allowNetwork(false)` is set. Async Lua,
  CommonJS and ES modules load through `installAsyncModules`/`runAsync`; there
  is no async `package.loadlib`.
- `f:seek()` on pipes and terminals fails with `ESPIPE`, as in PUC Lua.
- The sandbox memory limit is approximate (`collectgarbage("count")`), not an OS-level cap. Direct OPFS is worker-only and limited to files present at mount time or pre-created with `{ files }`; elsewhere OPFS is used for snapshots.


## Benchmarks and validation

- `node bench/run.js` runs the Lua benchmarks (`bench/*.lua`) on Fengari;
  `node bench/compare.js` also runs them under PUC Lua and prints the ratio.
- `node scripts/diff-puc.js` (`pnpm test:diff`) runs `test/differential/*.lua`
  under both engines and compares stdout and success/failure. It needs a
  `lua5.3`, `lua5.4` or `lua` binary (or `LUA_BIN`); CI installs `lua5.3`.
- CI runs the benchmark suite and the PUC comparison in a dedicated job, plus
  a bounded fuzz run.
- `node scripts/fuzz.js` feeds random and mutated chunks to the parser and
  undumper; it never executes them.
- `pnpm test:coverage` enforces the coverage thresholds in `jest.config.js`.


## Development

The CI uses [yarn](https://yarnpkg.com/), so `yarn.lock` is the source of truth for dependency resolution. `pnpm` also works for local development, but `pnpm-lock.yaml` is git-ignored to avoid two competing lockfiles.

- `yarn lint` (or `pnpm lint`)
- `yarn test` (or `pnpm test`)
- `yarn test:coverage` enforces the thresholds in `jest.config.js`
- `yarn check` runs lint, the API docs check and the full test suite
- `yarn build` generates the browser bundle, source map and minified file
- `yarn test:browser` runs the CDP suite against Brave/Chromium
- `yarn bench` / `yarn bench:compare` run the benchmark suite (PUC optional)
- `yarn test:diff` runs the PUC differential corpus
- `yarn fuzz` fuzzes the parser and undumper
- `yarn test test/lvm.test.js -t MOVE` to run a single test

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, test conventions and
commit style, and [SECURITY.md](SECURITY.md) to report a vulnerability
privately. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## References

- [Source code for Lua 5.3](lua.org/source/5.3/)
- [Lua 5.2 Bytecode and Virtual Machine](http://files.catwell.info/misc/mirror/lua-5.2-bytecode-vm-dirk-laurie/lua52vm.html)
- [Lua 5.3 Bytecode Reference](http://the-ravi-programming-language.readthedocs.io/en/latest/lua_bytecode_reference.html)
- [A No-Frills Introduction to Lua 5.1 VM Instructions](http://luaforge.net/docman/83/98/ANoFrillsIntroToLua51VMInstructions.pdf)
