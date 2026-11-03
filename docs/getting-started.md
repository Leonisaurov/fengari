# Getting started

Fengari runs Lua 5.3 (and opt-in 5.1/5.2/5.4 library profiles) on top of
JavaScript. This guide covers the common host shapes; the C API is documented
in [`api.md`](api.md), the high-level helpers in
[`high-level-api.md`](high-level-api.md) and the browser VFS in
[`browser.md`](browser.md).

## Node.js

```js
const { lua, lauxlib, lualib, api, to_luastring } = require("fengari");

// Low level: one state per isolate/worker.
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
lauxlib.luaL_dostring(L, to_luastring("print('hello from Lua')"));
lua.lua_close(L);

// High level: state + conversions + error handling.
const state = api.createState();
try {
    state.run("function add(a, b) return a + b end");
    console.log(state.call("add", [2, 3])); // 5
} finally {
    state.close();
}
```

`state.run` accepts source text or a compiled `Uint8Array`. Use
`state.compile(source)` to cache a chunk:

```js
const chunk = state.compile("return 6 * 7", "=(answer)");
state.run(chunk); // 42
```

Errors are `Error` objects with `luaMessage` and `luaTraceback`:

```js
try {
    state.run("error('boom')");
} catch (e) {
    console.error(e.luaMessage);    // includes 'boom'
    console.error(e.luaTraceback);  // Lua stack traceback
}
```

## Browser

```html
<script src="/node_modules/fengari/dist/fengari.min.js"></script>
<script>
    const { lua, lauxlib, lualib, vfs, api } = window.fengari;

    vfs.mount("/main.lua", "print('hello from the browser')");
    const state = api.createState();
    state.run('dofile("/main.lua")');
    state.close();
</script>
```

`dist/fengari.js` is also available unminified with a source map. The browser
build has no Node dependencies; `io`, `os.remove`, `os.rename`,
`require`/`dofile` and `loadfile` use the in-memory VFS. Persist it with
`vfs.saveToStorage`/`loadFromStorage` (localStorage), IndexedDB helpers, or
`mountOPFS` inside a worker. See [`browser.md`](browser.md).

## REPL

```js
const readline = require("readline");
const { api } = require("fengari");

const state = api.createState();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt("> ");
rl.prompt();
rl.on("line", (line) => {
    try {
        const result = state.run(line);
        if (result !== undefined)
            console.log(result);
    } catch (e) {
        console.error(e.luaMessage);
    }
    rl.prompt();
}).on("close", () => state.close());
```

Use `lualib.lua_setdebugreader(fn)` if you want `debug.debug()` to use the same
reader instead of a Node TTY/window prompt.

## Plugin host

Mount modules in the VFS and load them synchronously, or use the async module
loader when sources come from the network:

```js
const { lua, api, to_luastring } = require("fengari");
const state = api.createState();
state.pushJS({ log: (...args) => console.log(...args) });
lua.lua_setglobal(state.L, to_luastring("host"));
state.run("host.log('from Lua', 1 + 2)");

state.installAsyncModules({
    base: "/plugins/",
    map: { "my-plugin": "/plugins/my-plugin.lua" }
});
await state.runAsync('require("my-plugin").start()');
```

`api.sandbox({ instructions, milliseconds, memory })` hides `io`, `os`,
`package`, `debug`, `dofile`, `loadfile` and `require`, and limits execution.

## Game loop

Lua can be called from `requestAnimationFrame`/`setInterval` while the host
owns the clock:

```js
const state = api.createState();
state.run(`
    local t = 0
    function update(dt)
        t = t + dt
        return t
    end
`);

let last = performance.now();
setInterval(() => {
    const now = performance.now();
    const t = state.call("update", [(now - last) / 1000]);
    last = now;
    // use t for rendering
}, 16);
```

For a blocking synchronous bridge from a worker, see
`api.createSyncBridge`/`api.serveSyncBridge` and the browser tests in
`scripts/browser-test.js`.

## Next steps

- [`high-level-api.md`](high-level-api.md): conversion rules, promises, async
  modules, sandbox and workers.
- [`migrating-from-c.md`](migrating-from-c.md): strings, integers, stacks,
  errors and profiles when porting C code.
- [`api.md`](api.md): generated reference for the public modules.
- `bench/` and `scripts/diff-puc.js`: performance and PUC differential checks.
