"use strict";

const { api, lua } = require('../src/fengari.js');

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
