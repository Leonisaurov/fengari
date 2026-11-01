"use strict";

const lua = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib = require('../src/lualib.js');
const {to_luastring} = require("../src/fengaricore.js");

const run = function(luaCode) {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    if (lauxlib.luaL_loadstring(L, to_luastring(luaCode)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
    return L;
};

test('weak values are cleared when unreachable', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "v"})
        local x = {}
        t[1] = x
        x = nil
        collectgarbage()
        return t[1] == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('weak keys are cleared when unreachable', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "k"})
        local k = {}
        t[k] = 1
        k = nil
        collectgarbage()
        return next(t) == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('weak keys and values are both cleared', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "kv"})
        local k, v = {}, {}
        t[k] = v
        k = nil
        v = nil
        collectgarbage()
        return next(t) == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('ephemeron entries die with their key', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "k"})
        local k = {}
        t[k] = {k}       -- value points back at the key
        k = nil
        collectgarbage()
        return next(t) == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('weak tables keep reachable keys and values', () => {
    let L = run(`
        local keep = {}
        local t = setmetatable({}, {__mode = "v"})
        t[1] = keep
        local k = {}
        local kt = setmetatable({}, {__mode = "k"})
        kt[k] = 1
        collectgarbage()
        return t[1] == keep, next(kt) ~= nil
    `);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('weak values stay alive through closures', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "v"})
        local function make()
            local v = {}
            t[1] = v
            return function() return v end
        end
        local get = make()
        collectgarbage()
        return t[1] ~= nil, t[1] == get()
    `);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('strings and numbers are never removed from weak tables', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "kv"})
        t["hello"] = "world"
        t[1] = 2
        collectgarbage()
        return t.hello, t[1]
    `);
    expect(lua.lua_tojsstring(L, -2)).toBe("world");
    expect(lua.lua_tointeger(L, -1)).toBe(2);
});

test('weak tables respect __mode changes and pairs skips cleared entries', () => {
    let L = run(`
        local t = {1, 2}
        collectgarbage()
        local strong = t[1] ~= nil

        setmetatable(t, {__mode = "v"})
        t[1] = nil
        local keep = {}
        local dead = {}
        t[1] = keep
        t[2] = dead
        dead = nil
        collectgarbage()

        local n = 0
        for _ in pairs(t) do n = n + 1 end
        return strong, t[1] == keep, t[2] == nil, n
    `);
    expect(lua.lua_toboolean(L, -4)).toBe(true);
    expect(lua.lua_toboolean(L, -3)).toBe(true);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_tointeger(L, -1)).toBe(1);
});

test('collectgarbage("step") runs a cycle while the collector is running', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "v"})
        local x = {}
        t[1] = x
        x = nil
        collectgarbage("step")
        return t[1] == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('weak entries are collected automatically', () => {
    let L = run(`
        collectgarbage("setpause", 0)  -- keep the allocation budget small
        local t = setmetatable({}, {__mode = "v"})
        local x = {}
        t[1] = x
        x = nil
        for i = 1, 5000 do local tmp = {} end
        return t[1] == nil
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('__gc runs automatically without an explicit collectgarbage', () => {
    let L = run(`
        collectgarbage("setpause", 0)
        local calls = 0
        local t = setmetatable({}, {__gc = function() calls = calls + 1 end})
        t = nil
        for i = 1, 5000 do local tmp = {} end
        return calls > 0, calls
    `);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_tointeger(L, -1)).toBeGreaterThanOrEqual(1);
});

test('collectgarbage("step") is incremental and eventually completes', () => {
    let L = run(`
        local t = setmetatable({}, {__mode = "v"})
        local function fill()
            for i = 1, 100 do t[i] = {} end
        end
        fill()
        assert(collectgarbage("setstepmul", 10) == 200)
        local first = collectgarbage("step")
        local done = first
        local steps = 1
        while not done and steps < 200 do
            done = collectgarbage("step")
            steps = steps + 1
        end
        return first, done, steps, next(t) == nil
    `);
    expect(lua.lua_toboolean(L, -4)).toBe(false);
    expect(lua.lua_toboolean(L, -3)).toBe(true);
    expect(lua.lua_tointeger(L, -2)).toBeGreaterThan(1);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('incremental marking processes a large graph in chunks', () => {
    let L = run(`
        local keep = {}
        for i = 1, 3000 do keep[i] = {i} end
        assert(collectgarbage("setstepmul", 10) == 200)
        local first = collectgarbage("step")
        local done = first
        local steps = 1
        while not done and steps < 5000 do
            done = collectgarbage("step")
            steps = steps + 1
        end
        return first, done, steps, keep[1][1], keep[3000][1]
    `);
    expect(lua.lua_toboolean(L, -5)).toBe(false);
    expect(lua.lua_toboolean(L, -4)).toBe(true);
    expect(lua.lua_tointeger(L, -3)).toBeGreaterThan(10);
    expect(lua.lua_tointeger(L, -2)).toBe(1);
    expect(lua.lua_tointeger(L, -1)).toBe(3000);
});

test('incremental marking keeps values written through a barrier', () => {
    let L = run(`
        local bulk = {}
        for i = 1, 3000 do bulk[i] = {} end

        local weak = setmetatable({}, {__mode = "v"})
        local x = {}
        weak[1] = x
        x = nil

        collectgarbage("setstepmul", 10)
        collectgarbage("step")       -- marking is still in progress

        local t = weak[1]            -- retrieve before sweeping
        _G.KEEP = t                  -- write into the (already marked) globals
        t = nil                      -- drop it from the stack

        local done = false
        while not done do done = collectgarbage("step") end

        local ok = _G.KEEP ~= nil and weak[1] == _G.KEEP
        _G.KEEP = nil
        return ok
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('incremental marking keeps resurrected finalizable objects', () => {
    let L = run(`
        local bulk = {}
        for i = 1, 3000 do bulk[i] = {} end

        local saved = nil
        local mt = {__gc = function(o) saved = o end}
        local weak = setmetatable({}, {__mode = "v"})
        local t = setmetatable({}, mt)
        weak[1] = t
        t = nil

        collectgarbage("setstepmul", 10)
        collectgarbage("step")

        local tmp = weak[1]
        _G.KEEP = tmp
        tmp = nil

        local done = false
        while not done do done = collectgarbage("step") end
        local survived = _G.KEEP ~= nil and saved == nil

        _G.KEEP = nil
        collectgarbage()
        return survived, saved ~= nil
    `);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('collectgarbage("count") tracks live Lua memory', () => {
    let L = run(`
        local before = collectgarbage("count")
        local big = {}
        for i = 1, 5000 do big[i] = "x" .. i end
        local during = collectgarbage("count")
        big = nil
        collectgarbage()
        local after = collectgarbage("count")
        return before > 0, during > before, after < during
    `);
    expect(lua.lua_toboolean(L, -3)).toBe(true);
    expect(lua.lua_toboolean(L, -2)).toBe(true);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('collectgarbage("count") accounts for userdata size', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);

    const count = function() {
        return lua.lua_gc(L, lua.LUA_GCCOUNT, 0) +
            lua.lua_gc(L, lua.LUA_GCCOUNTB, 0) / 1024;
    };

    const before = count();
    lua.lua_newuserdata(L, 5001);
    const during = count();
    lua.lua_pop(L, 1);
    lua.lua_gc(L, lua.LUA_GCCOLLECT, 0);
    const after = count();

    expect(during - before).toBeGreaterThan(4);  /* more than 4 KiB */
    expect(after).toBeLessThan(during);
    expect(after).toBeCloseTo(before, 5);
});

test('collector settings are per state', () => {
    let L1 = lauxlib.luaL_newstate();
    let L2 = lauxlib.luaL_newstate();
    if (!L1 || !L2) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L1);
    lualib.luaL_openlibs(L2);

    lua.lua_gc(L1, lua.LUA_GCSTOP, 0);
    expect(lua.lua_gc(L1, lua.LUA_GCISRUNNING, 0)).toBe(0);
    expect(lua.lua_gc(L2, lua.LUA_GCISRUNNING, 0)).toBe(1);

    lua.lua_close(L1);
    lua.lua_close(L2);
});


test('__gc runs once for unreachable tables', () => {
    let L = run(`
        local calls = 0
        local t = setmetatable({}, {__gc = function() calls = calls + 1 end})
        t = nil
        collectgarbage()
        collectgarbage()
        return calls
    `);
    expect(lua.lua_tointeger(L, -1)).toBe(1);
});

test('__gc does not run for reachable tables', () => {
    let L = run(`
        local calls = 0
        local t = setmetatable({}, {__gc = function() calls = calls + 1 end})
        collectgarbage()
        return calls, type(t)
    `);
    expect(lua.lua_tointeger(L, -2)).toBe(0);
    expect(lua.lua_tojsstring(L, -1)).toBe("table");
});

test('a resurrected object is not finalized twice', () => {
    let L = run(`
        local calls, saved = 0, nil
        local mt = {__gc = function(o) calls = calls + 1; saved = o end}
        local t = setmetatable({}, mt)
        t = nil
        collectgarbage()
        local first = calls
        saved = nil
        collectgarbage()
        return first, calls
    `);
    expect(lua.lua_tointeger(L, -2)).toBe(1);
    expect(lua.lua_tointeger(L, -1)).toBe(1);
});

test('errors in __gc propagate out of collectgarbage', () => {
    let L = run(`
        local t = setmetatable({}, {__gc = function() error("boom") end})
        t = nil
        local ok, err = pcall(collectgarbage)
        return ok, tostring(err)
    `);
    expect(lua.lua_toboolean(L, -2)).toBe(false);
    expect(lua.lua_tojsstring(L, -1)).toContain("boom");
});

test('collectgarbage("step") respects a stopped collector', () => {
    let L = run(`
        local calls = 0
        local t = setmetatable({}, {__gc = function() calls = calls + 1 end})
        t = nil
        collectgarbage("stop")
        collectgarbage("step")
        local after_step = calls
        collectgarbage("restart")
        collectgarbage()
        return after_step, calls
    `);
    expect(lua.lua_tointeger(L, -2)).toBe(0);
    expect(lua.lua_tointeger(L, -1)).toBe(1);
});

test('__gc receives the object being collected', () => {
    let L = run(`
        local typ, same
        local t = setmetatable({marker = 42}, {
            __gc = function(o)
                typ = type(o)
                same = (o.marker == 42)
            end
        })
        t = nil
        collectgarbage()
        return typ, same
    `);
    expect(lua.lua_tojsstring(L, -2)).toBe("table");
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('__gc runs for unreachable userdata', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);

    let calls = 0;
    let argtype = null;
    lauxlib.luaL_newmetatable(L, to_luastring("test.gc"));
    lua.lua_pushcfunction(L, function(Ln) {
        calls++;
        argtype = lua.lua_type(Ln, 1);
        return 0;
    });
    lua.lua_setfield(L, -2, to_luastring("__gc"));
    lua.lua_pop(L, 1);

    lua.lua_newuserdata(L);
    lauxlib.luaL_setmetatable(L, to_luastring("test.gc"));
    lua.lua_pop(L, 1);  /* drop the only reference */

    lua.lua_gc(L, lua.LUA_GCCOLLECT, 0);
    expect(calls).toBe(1);
    expect(argtype).toBe(lua.LUA_TUSERDATA);
});

test('lua_close finalizes pending objects', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);

    let calls = 0;
    lauxlib.luaL_newmetatable(L, to_luastring("test.gc.close"));
    lua.lua_pushcfunction(L, function() {
        calls++;
        return 0;
    });
    lua.lua_setfield(L, -2, to_luastring("__gc"));
    lua.lua_pop(L, 1);

    lua.lua_newuserdata(L);
    lauxlib.luaL_setmetatable(L, to_luastring("test.gc.close"));
    lua.lua_pop(L, 1);

    lua.lua_close(L);
    expect(calls).toBe(1);
});
