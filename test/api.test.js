"use strict";

const { api, lua } = require('../src/fengari.js');
const { to_luastring } = require('../src/fengaricore.js');

test('api.run and api.createState evaluate code', () => {
    const state = api.createState();
    try {
        expect(state.run("return 1 + 2")).toBe(3);
        expect(state.run("return 'a', 2, true")).toEqual(["a", 2, true]);
        expect(state.run("return nil")).toBe(null);
        expect(state.run("return 1.5")).toBe(1.5);
        expect(state.run("return")).toBe(undefined);
    } finally {
        state.close();
    }
});

test('api.compile caches a binary chunk', () => {
    const state = api.createState();
    try {
        const chunk = state.compile("return 6 * 7", "=(cached)");
        expect(chunk).toBeInstanceOf(Uint8Array);
        expect(chunk[0]).toBe(27);  /* Lua signature */
        expect(state.run(chunk)).toBe(42);
        expect(state.run(chunk)).toBe(42);
        expect(() => state.compile("this is not lua")).toThrow(/syntax|unexpected|near/);
    } finally {
        state.close();
    }
});


test('api.dostring reports errors with a traceback', () => {
    const state = api.createState();
    try {
        let error = null;
        try {
            state.dostring("local function f() error('boom') end f()");
        } catch (e) {
            error = e;
        }
        expect(error).not.toBe(null);
        expect(error.luaMessage).toContain("boom");
        expect(error.luaTraceback).toContain("stack traceback:");
    } finally {
        state.close();
    }
});

test('api.call invokes globals and stack values', () => {
    const state = api.createState();
    try {
        state.run("function add(a, b) return a + b end function concat(a, b) return a .. b end");
        expect(state.call("add", [2, 3])).toBe(5);
        expect(state.call("concat", ["x", "y"])).toBe("xy");

        state.run("function multi() return 1, 2, 3 end");
        expect(state.call("multi")).toEqual([1, 2, 3]);

        expect(() => state.call("does_not_exist")).toThrow(/not a function/);
    } finally {
        state.close();
    }
});

test('api.toJS converts arrays, objects and nested values', () => {
    const state = api.createState();
    try {
        expect(state.run("return {1, 2, 3}")).toEqual([1, 2, 3]);
        expect(state.run("return {a = 1, b = 'two'}")).toEqual({ a: 1, b: "two" });
        expect(state.run("return {x = {y = {z = 3}}}")).toEqual({ x: { y: { z: 3 } } });
        expect(state.run("return {[2] = 'hole'}")).toEqual({ 2: "hole" });

        let error = null;
        try {
            state.run("local t = {} t.self = t return t");
        } catch (e) {
            error = e;
        }
        expect(error).not.toBe(null);
        expect(error.message).toMatch(/cycle/);
    } finally {
        state.close();
    }
});

test('api.pushJS exposes JS functions and values to Lua', () => {
    const state = api.createState();
    try {
        state.pushJS((a, b) => a * b);
        lua.lua_setglobal(state.L, "mul");
        expect(state.run("return mul(6, 7)")).toBe(42);

        state.pushJS({ name: "js", values: [1, 2] });
        lua.lua_setglobal(state.L, "obj");
        expect(state.run("return obj.name, obj.values[2]")).toEqual(["js", 2]);
    } finally {
        state.close();
    }
});

test('api.pushJS converts Maps, Sets and iterables', () => {
    const state = api.createState();
    try {
        state.pushJS(new Map([["a", 1], ["b", 2]]));
        lua.lua_setglobal(state.L, to_luastring("m"));
        expect(state.run("return m.a, m.b")).toEqual([1, 2]);

        state.pushJS(new Set([3, 4, 5]));
        lua.lua_setglobal(state.L, to_luastring("s"));
        expect(state.run("return s[1], s[2], s[3], #s")).toEqual([3, 4, 5, 3]);

        function* numbers() {
            yield 6;
            yield 7;
        }
        state.pushJS(numbers());
        lua.lua_setglobal(state.L, to_luastring("it"));
        expect(state.run("return it[1], it[2], #it")).toEqual([6, 7, 2]);
    } finally {
        state.close();
    }
});


test('api.toJS rejects deep nesting and pushJS handles bytes and errors', () => {
    const state = api.createState();
    try {
        expect(() => state.run(`
            local root = {}
            local cur = root
            for i = 1, 102 do
                cur[1] = {}
                cur = cur[1]
            end
            return root
        `)).toThrow(/nested too deeply/);

        state.pushJS(new Uint8Array([104, 105]));
        lua.lua_setglobal(state.L, "bytes");
        expect(state.run("return bytes, #bytes")).toEqual(["hi", 2]);

        state.pushJS(() => { throw new Error("js boom"); });
        lua.lua_setglobal(state.L, "boom");
        expect(() => state.run("return boom()")).toThrow(/js boom/);

        state.pushJS(2 ** 40);
        lua.lua_setglobal(state.L, "big");
        expect(state.run("return big")).toBe(2 ** 40);
    } finally {
        state.close();
    }
});

test('api.sandbox hides dangerous globals', () => {
    const box = api.sandbox({ instructions: 1000000 });
    try {
        expect(box.run("return type(io), type(os), type(require), type(debug)"))
            .toEqual(["nil", "nil", "nil", "nil"]);
        expect(box.run("return type(load), type(string), type(table), type(math)"))
            .toEqual(["function", "table", "table", "table"]);
        expect(box.run("return 2 + 2")).toBe(4);
    } finally {
        box.close();
    }
});

test('api.sandbox enforces an instruction limit', () => {
    const box = api.sandbox({ instructions: 20000 });
    try {
        expect(() => box.run("while true do end")).toThrow(/instruction limit/);
        /* the state survives the error */
        expect(box.run("return 7")).toBe(7);
    } finally {
        box.close();
    }
});

test('api.sandbox enforces a wall clock limit', () => {
    const box = api.sandbox({ milliseconds: 50 });
    try {
        expect(() => box.run("while true do end")).toThrow(/time limit/);
    } finally {
        box.close();
    }
});

test('api.sandbox allows customizing the hidden globals', () => {
    const box = api.sandbox({ hide: ["io"], instructions: 1000000 });
    try {
        expect(box.run("return type(io), type(os)")).toEqual(["nil", "table"]);
    } finally {
        box.close();
    }
});

test('api.sandbox enforces an approximate memory limit', () => {
    const box = api.sandbox({ memory: 500 });  /* KB */
    try {
        expect(() => box.run(`
            local t = {}
            for i = 1, 20000 do
                t[i] = string.rep("x", 100)
            end
        `)).toThrow(/memory limit/);
        /* reset collects garbage before the next run */
        expect(box.run("return 7")).toBe(7);
    } finally {
        box.close();
    }
});

test('api async functions resolve Promises through runAsync/callAsync', async () => {
    const state = api.createState();
    try {
        state.pushAsyncJS(async (a, b) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return a + b;
        });
        lua.lua_setglobal(state.L, "awaitAdd");

        expect(await state.runAsync("return awaitAdd(2, 3)")).toBe(5);
        expect(await state.runAsync("return awaitAdd(1, 1) + awaitAdd(2, 2)")).toBe(6);
        expect(await state.runAsync("return 10")).toBe(10);

        state.pushAsyncJS((value) => value * 3);  /* non-Promise result */
        lua.lua_setglobal(state.L, "triple");
        expect(await state.runAsync("return triple(4)")).toBe(12);

        state.pushAsyncJS(async () => {
            throw new Error("async boom");
        });
        lua.lua_setglobal(state.L, "fail");
        await expect(state.runAsync("return fail()")).rejects.toThrow(/async boom/);

        state.run("function add(a, b) return awaitAdd(a, b) end");
        expect(await state.callAsync("add", [4, 5])).toBe(9);
    } finally {
        state.close();
    }
});

test('api.installAsyncModules fetches missing Lua modules under runAsync', async () => {
    const state = api.createState();
    try {
        let fetched = [];
        state.installAsyncModules({
            fetch: async (name, url) => {
                fetched.push(name + "|" + url);
                if (name === "greet")
                    return "return { hello = function() return 'hi' end }";
                return null;
            }
        });

        expect(await state.runAsync('local m = require("greet") return m.hello()')).toBe("hi");
        expect(fetched[0]).toBe("greet|/modules/greet.lua");

        state.installAsyncModules({
            map: { alias: "/custom/alias.lua" },
            fetch: async (name, url) => url === "/custom/alias.lua" ? "return 42" : null
        });
        expect(await state.runAsync('return require("alias")')).toBe(42);

        await expect(state.runAsync('return require("missing")')).rejects.toThrow(/not found/);

        state.run('package.preload["local"] = function() return 5 end');
        let calls = 0;
        state.installAsyncModules({ fetch: async () => { calls++; return "return 1"; } });
        expect(await state.runAsync('return require("local")')).toBe(5);
        expect(calls).toBe(0);
    } finally {
        state.close();
    }
});

test('api.installAsyncModules loads CommonJS and ES modules', async () => {
    const state = api.createState();
    try {
        state.installAsyncModules({
            js: {
                map: {
                    cjs: "data:text/javascript,module.exports%3D%7Bvalue%3A21%7D",
                    fn: "data:text/javascript,module.exports%3Dfunction(x)%7Breturn%20x*2%7D"
                }
            }
        });
        expect(await state.runAsync('return require("cjs").value')).toBe(21);
        expect(await state.runAsync('return require("fn")(4)')).toBe(8);

        state.installAsyncModules({
            js: {
                import: async () => ({ default: { value: 7 } }),
                map: {
                    esm: {
                        url: "data:text/javascript,export%20default%20%7B%20value%3A%207%20%7D",
                        format: "esm"
                    }
                }
            }
        });
        expect(await state.runAsync('return require("esm").value')).toBe(7);
    } finally {
        state.close();
    }
});

const make_port = function() {
    const listeners = new Set();
    return {
        addEventListener: (type, fn) => { if (type === "message") listeners.add(fn); },
        removeEventListener: (type, fn) => { listeners.delete(fn); },
        start: () => {},
        close: () => {},
        postMessage: () => {},
        dispatch: (data) => Promise.all(Array.from(listeners).map((fn) => fn({ data }))),
        listener_count: () => listeners.size
    };
};

test('createSyncBridge validates arguments and reports failures', () => {
    const port = make_port();
    expect(() => api.createSyncBridge(null, new SharedArrayBuffer(64))).toThrow(/MessagePort/);
    expect(() => api.createSyncBridge(port, null)).toThrow(/SharedArrayBuffer/);

    const small = api.createSyncBridge(port, new SharedArrayBuffer(20));
    expect(() => small.call("a long operation name")).toThrow(/too large/);

    const stalled = api.createSyncBridge(port, new SharedArrayBuffer(64), { timeout: 5 });
    expect(() => stalled.call("x")).toThrow(/timed out/);

    const shared = new SharedArrayBuffer(64);
    const header = new Int32Array(shared, 0, 4);
    const racing = {
        postMessage: () => Atomics.store(header, 0, 3),
        close: () => {}
    };
    const bridge = api.createSyncBridge(racing, shared, { timeout: 5 });
    expect(() => bridge.call("x")).toThrow(/invalid state/);
    bridge.close();
});

test('serveSyncBridge answers requests and reports handler errors', async () => {
    const shared = new SharedArrayBuffer(1024);
    const port = make_port();
    const server = api.serveSyncBridge(port, shared, async (op, a, b) => {
        if (op === "fail")
            throw new Error("handler boom");
        return a + b;
    });

    const header = new Int32Array(shared, 0, 4);
    const data = new Uint8Array(shared, 16);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const request = async (op, args) => {
        const bytes = encoder.encode(JSON.stringify({ id: 1, op: op, args: args }));
        data.set(bytes);
        Atomics.store(header, 1, bytes.length);
        Atomics.store(header, 0, 1);
        await port.dispatch({ type: "fengari-sync-request" });
        expect(Atomics.load(header, 0)).toBe(2);
        const length = Atomics.load(header, 2);
        return JSON.parse(decoder.decode(data.slice(0, length)));
    };

    expect(await request("add", [2, 3])).toEqual({ value: 5 });
    expect(await request("fail", [])).toEqual({ error: "handler boom" });
    expect(port.listener_count()).toBe(1);
    server.close();
    expect(port.listener_count()).toBe(0);
});


test('async helpers report load, lookup and synchronous failures', async () => {
    const state = api.createState();
    try {
        await expect(state.runAsync("this is not lua")).rejects.toThrow(/unexpected|near/);
        await expect(state.callAsync("missing_global")).rejects.toThrow(/not a function/);

        state.pushAsyncJS(() => { throw new Error("sync boom"); });
        lua.lua_setglobal(state.L, "boom");
        await expect(state.runAsync("return boom()")).rejects.toThrow(/sync boom/);

        state.installAsyncModules({
            js: {
                import: async () => ({ namespaceOnly: 7 }),
                map: { ns: { url: "/namespace.mjs", format: "esm" } }
            }
        });
        expect(await state.runAsync('return require("ns").namespaceOnly')).toBe(7);

        state.installAsyncModules({
            js: {
                map: { returned: "data:text/javascript,return%20%7Bvalue%3A3%7D" }
            }
        });
        expect(await state.runAsync('return require("returned").value')).toBe(3);
    } finally {
        state.close();
    }
});
