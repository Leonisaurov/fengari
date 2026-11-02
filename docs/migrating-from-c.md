# Migrating a Lua C host to Fengari

Fengari is a JavaScript port of the Lua 5.3 VM. The C API keeps the same names
and stack discipline (`lua_*`, `luaL_*`), but a few types and conventions are
JavaScript-specific. This guide covers the common changes when moving an
embedding from the C implementation.

## Quick start

```js
const {
    lua,
    lauxlib,
    lualib,
    to_luastring,
    to_jsstring
} = require("fengari");

const L = lauxlib.luaL_newstate();
if (!L) throw new Error("failed to create state");
lualib.luaL_openlibs(L);

const chunk = to_luastring("return 1 + 1");
if (lauxlib.luaL_loadstring(L, chunk) !== lua.LUA_OK)
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)));

if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK)
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)));

console.log(lua.lua_tonumber(L, -1)); // 2
lua.lua_close(L);
```

`luaL_newstate()` optionally takes a version profile, for example
`luaL_newstate("5.2")`; see [Lua versions](../README.md#lua-versions).

## Strings are bytes, not JavaScript strings

Lua strings are `Uint8Array` instances. They can contain `\0` and invalid
UTF-8. Use the conversion helpers at the JS boundary:

| Direction | Helper |
| --- | --- |
| JS string -> Lua bytes | `to_luastring("hello")` |
| Lua bytes -> JS string | `to_jsstring(bytes)` |
| Lua stack -> JS string | `lua_tojsstring(L, idx)` (returns `null` if not a string) |
| Lua stack -> bytes | `lua_tostring(L, idx)` / `lua_tolstring(L, idx)` |
| Push a JS string literal | `lua_pushliteral(L, "hello")` |
| Push bytes or a JS string | `lua_pushstring(L, value)` |
| Push N bytes | `lua_pushlstring(L, bytes, n)` |

```js
lua.lua_pushliteral(L, "texto");
lua.lua_pushstring(L, to_luastring("bytes"));
const view = lua.lua_todataview(L, -1); // zero-copy DataView
```

`lua_tojsstring` returns `null` for values that are not strings or numbers.
Do not pass that `null` to `to_jsstring`/`Uint8Array` helpers.

## Numbers: 32-bit integers

The integer subtype is **32-bit** (`LUA_MAXINTEGER = 2147483647`).
Arithmetic wraps; JavaScript `Number` is used for the float subtype.

```js
lua.lua_pushinteger(L, 42);
lua.lua_pushnumber(L, 1.5);

if (lua.lua_isinteger(L, -1))
    console.log(lua.lua_tointeger(L, -1));

const n = lua.lua_tointegerx(L, -1); // false when not convertible
const d = lua.lua_tonumberx(L, -1);  // false when not convertible
```

In C, `lua_tointegerx` and `lua_tonumberx` use out-parameters. In Fengari they
return the value or `false`; there is no `isnum` out-parameter.

## Stack discipline

Indices, positive and negative, work as in C. Pseudo-indices are available:
`LUA_REGISTRYINDEX` and `lua_upvalueindex(i)`.

```js
const top = lua.lua_gettop(L);
lua.lua_pushvalue(L, 1);
lua.lua_rotate(L, -2, 1);
lua.lua_copy(L, 1, -1);
lua.lua_settop(L, top);
lua.lua_pop(L, 2);
```

Use `lua_checkstack(L, n)` before pushing an unknown amount. C functions
receive the state and return the number of Lua results:

```js
function js_add(L) {
    const a = lua.luaL_checknumber(L, 1);
    const b = lua.luaL_checknumber(L, 2);
    lua.lua_pushnumber(L, a + b);
    return 1;
}

lua.lua_pushcfunction(L, js_add);
lua.lua_setglobal(L, to_luastring("js_add"));
```

`lua_pushjsfunction` is an alias. Closures use `lua_pushcclosure(L, fn, n)`;
read upvalues with `lua_upvalueindex(i)`.

## Tables

```js
lua.lua_newtable(L);

lua.lua_pushliteral(L, "one");
lua.lua_pushinteger(L, 1);
lua.lua_setfield(L, -3, to_luastring("name"));

lua.lua_pushinteger(L, 42);
lua.lua_seti(L, -2, 1);          // t[1] = 42

lua.lua_getfield(L, -1, to_luastring("name"));
lua.lua_rawgeti(L, -2, 1);
console.log(lua.lua_tointeger(L, -1)); // 42
```

`lua_settable`/`lua_gettable` consume/produce values on the stack. `lua_next`
works as in C: push `nil` to start, then the previous key for each iteration:

```js
lua.lua_pushnil(L);
while (lua.lua_next(L, -2) !== 0) {
    // key at -2, value at -1
    lua.lua_pop(L, 1); // keep only the key for the next call
}
```

## Calling Lua from JavaScript

`lua_call` is unprotected; Lua errors throw `L.errorJmp` and must not be
caught with a plain `try/catch`. Use `lua_pcall` at the JS boundary:

```js
const status = lua.lua_pcall(L, nargs, nresults, 0);
if (status !== lua.LUA_OK) {
    const message = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    throw new Error(message);
}
```

For a traceback, push the message handler or call `luaL_traceback`:

```js
lauxlib.luaL_traceback(L, L, to_luastring("context"), 1);
```

Native JavaScript exceptions are not Lua errors. Install
`lua_atnativeerror(L, handler)` to convert them; the handler receives the JS
error as light userdata and should leave a Lua value on the stack.

## Calling JavaScript from Lua

Register JS functions with `lua_pushcfunction`/`lua_pushcclosure` and store
them in globals or tables. Userdata is different from C: `lua_newuserdata`
returns a JS object (the userdata payload) and pushes the userdata:

```js
function new_buffer(L) {
    const data = lua.lua_newuserdata(L, 0); // returns the payload object
    data.bytes = [];
    lauxlib.luaL_setmetatable(L, to_luastring("Buffer"));
    return 1;
}

function buffer_push(L) {
    const data = lauxlib.luaL_checkudata(L, 1, to_luastring("Buffer"));
    data.bytes.push(lua.luaL_checkinteger(L, 2));
    return 0;
}
```

```js
lauxlib.luaL_newmetatable(L, to_luastring("Buffer"));
lua.lua_pushcfunction(L, buffer_push);
lua.lua_setfield(L, -2, to_luastring("push"));
lua.lua_pushvalue(L, -1);
lua.lua_setfield(L, -2, to_luastring("__index"));
lua.lua_pop(L, 1);
```

`lua_touserdata` returns the payload; `luaL_checkudata` validates the
metatable and returns it. There is no pointer arithmetic.

## Registry and references

The registry is the pseudo-index `LUA_REGISTRYINDEX`. `luaL_ref` and
`luaL_unref` store/remove values as in C:

```js
lua.lua_pushvalue(L, 1);
const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
```

`lua_toproxy(L, idx)` is a Fengari extension: it returns a function that
pushes the value onto a state from the same global state. `lua_isproxy`
checks whether a JS function is such a proxy. Proxies keep the value alive in
JS, but they are **not** Lua GC roots; anchor values in the registry or on a
stack if the Lua collector must see them.

## Coroutines

```js
const co = lua.lua_newthread(L);
lua.lua_getglobal(co, to_luastring("worker")); // push function on co's stack
const status = lua.lua_resume(co, L, 0);
if (status !== lua.LUA_OK && status !== lua.LUA_YIELD)
    throw new Error(lua.lua_tojsstring(co, -1));
```

`lua_yieldk` and `lua_callk` accept JS continuations for C functions that
need to yield. `lua_resume` returns `LUA_OK` or `LUA_YIELD`; errors are on the
coroutine stack.

## Garbage collection

Fengari uses a Lua-side mark/sweep for weak tables, finalizers and
`collectgarbage("count")`, while ordinary object reclamation is left to the
JavaScript GC.

- `lua_gc(L, LUA_GCCOLLECT, 0)` runs a full Lua cycle.
- `LUA_GCSTEP` is incremental; `LUA_GCSETPAUSE`/`LUA_GCSETSTEPMUL` tune it.
- `LUA_GCCOUNT` reports an estimate of live Lua objects, not the JS heap.
- `__mode` weak tables and `__gc` work as in Lua 5.3, but host-held values
  must be anchored in the Lua state.
- `collectgarbage("stop")` stops automatic Lua cycles; `collect` still works.

Do not rely on JavaScript finalizers for Lua objects.

## Modules and `require`

`package.jspath` replaces `package.cpath`; `LUA_JSPATH_DEFAULT` replaces
`LUA_CPATH_DEFAULT`. Node loads `.js` modules; browsers used to fall back to
synchronous XHR. In an embedded host, register modules in `package.preload`
or set `package.jspath` explicitly.

## `io` and `os`

The `io` library covers the Lua 5.3 surface: `io.open`, `io.read`, `io.write`,
`io.lines`, `io.input`, `io.output`, `io.tmpfile`, `io.popen` and the
corresponding file methods (`read`, `write`, `lines`, `seek`, `setvbuf`,
`flush`, `close`). Under Node, file handles are backed by file descriptors;
because Node has no `lseek`, the position is tracked in JS, so `seek` works on
regular files but not on pipes or terminals.

Without a Node `process` (browsers, workers, embedded engines) `io` and the
file related parts of `os` run on an in-memory file system, exposed as
`fengari.vfs`. The host mounts files before running Lua:

```js
const { vfs } = require("fengari");
vfs.mount("/main.lua", "return 42");
vfs.setStdin("input\n");
vfs.setStdout((line) => console.log(line));

// ... run Lua ...

const snapshot = vfs.snapshot();  // [{ path, data }, ...]
```

`loadfile`, `dofile` and `require` check the virtual file system before
falling back to synchronous XHR; mounted `.lua` and `.js` modules load without
network access. `os.remove`, `os.rename`, `os.tmpname` and `os.getenv` use the
same file system and a host-provided environment. `io.tmpfile`/`os.tmpname`
live under `/tmp`. Nothing is persisted automatically: use
`vfs.saveToStorage()`/`loadFromStorage()` (localStorage),
`vfs.saveToIndexedDB()`/`loadFromIndexedDB()` (IndexedDB) or
`vfs.saveToOPFS()`/`loadFromOPFS()` (an OPFS directory handle), or take a
`vfs.snapshot()` and `vfs.restore()` it later. In a worker,
`await vfs.mountOPFS(dir)` makes OPFS files (recursively) the live file system
through synchronous access handles; `{ files: [...] }` pre-creates paths. Call
`vfs.unmountOPFS()` to flush and close. `vfs.allowNetwork(false)`
disables the XHR fallback so `require`/`loadfile` only read the VFS.
`vfs.loadFromURL(url, path)` fetches and mounts a module asynchronously, after
which the synchronous `require`/`dofile` can use it.

`node scripts/build-browser.js` (or `pnpm build`) emits `dist/fengari.js`
(plus a source map) and `dist/fengari.min.js`, IIFEs that expose
`window.fengari`. The browser tests (`pnpm test:browser`)
drive Brave headless through the Chrome DevTools Protocol, not Playwright.

Two limits are worth knowing. `io.popen` cannot stream under Lua's synchronous
semantics: read mode runs the command with `spawnSync` and buffers its stdout,
and write mode buffers the writes and feeds them when the handle is closed;
without a process API, `io.popen`, `os.execute` and `os.exit` fail with a clear
error. `setvbuf` controls a JS write buffer (`no`/`full`/`line`), so buffered
writes only reach the underlying file on `flush`, when the buffer fills, on a
newline (line mode), on `seek`, or on `close`; fd based I/O itself remains
unbuffered.

## High-level API

`require("fengari").api` provides `createState`, `run`, `dostring`, `dofile`,
`call`, `toJS`, `pushJS` and `sandbox` on top of the C API. It converts tables
and arrays to JS values, wraps JS functions as Lua functions, and turns Lua
errors into `Error` objects with `luaMessage` and `luaTraceback`.

`pushAsyncJS` wraps a function that returns a Promise; `runAsync`/`callAsync`
run the chunk in a coroutine, await the Promise and resume it, so Lua sees the
resolved value (a rejection becomes a Lua error). Async functions only work
under those drivers; plain `run`/`call` stay synchronous.
`installAsyncModules({ base, map, js })` installs a searcher that fetches
missing Lua modules and can evaluate CommonJS/ES modules (with import-map
overrides) while under `runAsync`. `api.createSyncBridge`/`serveSyncBridge`
implement a blocking worker→host call with `SharedArrayBuffer` and `Atomics`. The sandbox
hides `io`, `os`, `package`, `debug`, `dofile`, `loadfile` and `require` by
default and enforces instruction, wall-clock and approximate memory limits
(`instructions`, `milliseconds`, `memory` in KB). The memory limit uses
`collectgarbage("count")`, so it is an estimate, not an OS cap. ES module
bindings and TypeScript definitions ship with the package.

## Version profiles

```js
const L52 = lauxlib.luaL_newstate("5.2");
lualib.luaL_openlibs(L52);
```

The bundled 5.1/5.2/5.4 profiles change the library surface and the accepted
syntax (5.1/5.2 reject `//`/bitwise operators and parse literals as floats;
5.1 treats `goto` as a name), but the VM and `undump` still share the Lua
5.3 internal integer subtype. Supply a full implementation via
`versions.register({loadbufferx, openlibs, ...})` if you need a double-only
number model or per-version binary chunks.

## Differences from the C API

| C | Fengari |
| --- | --- |
| `lua_State *L` | `lua_State` object (`L`) |
| `lua_tostring` returns `const char *` | returns `Uint8Array` |
| `lua_tointegerx(L, i, &isnum)` | returns integer or `false` |
| `lua_tonumberx(L, i, &isnum)` | returns number or `false` |
| `lua_pushliteral(L, "x")` | takes a JS string |
| `lua_pushstring(L, s)` | accepts bytes or a JS string |
| `lua_newuserdata` returns pointer | returns the JS payload object |
| `lua_touserdata` returns pointer | returns the JS payload object |
| `luaL_execresult`/`luaL_fileresult` | take an extra JS error object |
| Lua errors use `longjmp` | throw `L.errorJmp`; catch at `lua_pcall` |
| `lua_gc` controls a precise GC | approximate count, Lua-side cycles |

## Migration checklist

- Replace `char *`/`size_t` string handling with `Uint8Array` and the
  conversion helpers.
- Replace every unprotected `lua_call` with `lua_pcall` at JS boundaries.
- Convert C function pointers to JS functions returning a result count.
- Replace userdata structs/pointers with JS payload objects and metatables.
- Replace `lua_tointegerx`/`lua_tonumberx` out-parameters with `false` checks.
- Anchor values that must survive Lua collection in the registry/stack.
- Audit integer assumptions for the 32-bit model.
- Test in Node and in the browser bundle separately; `io`/`os` differ.
