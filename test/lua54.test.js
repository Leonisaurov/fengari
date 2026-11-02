"use strict";

const lua     = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib  = require('../src/lualib.js');
const versions = require('../src/versions.js');
const { to_jsstring, to_luastring } = require("../src/fengaricore.js");

const open = function(version) {
    let L = lauxlib.luaL_newstate(version);
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    return L;
};

const run = function(L, code) {
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
};

test('the 5.4 profile is registered and keeps the 5.3 default', () => {
    expect(versions.list()).toEqual(expect.arrayContaining(["5.1", "5.2", "5.3", "5.4"]));
    expect(versions.getDefault()).toBe("5.3");
    expect(versions.get("5.4").version.num).toBe(504);
    expect(versions.get("lua54").name).toBe("5.4");
    expect(versions.get("5.4").features.close).toBe(true);
    expect(versions.get("5.4").features.warn).toBe(true);
    expect(versions.get("5.4").features.random54).toBe(true);
});

test('the 5.4 surface is opt-in', () => {
    let L53 = open("5.3");
    let L54 = open("5.4");

    expect(lua.lua_version(L53)).toBe(503);
    expect(lua.lua_version(L54)).toBe(504);

    run(L53, `
        assert(_VERSION == "Lua 5.3")
        assert(type(warn) == "nil")
        assert(type(coroutine.close) == "nil")
        assert(not pcall(math.random, 0))
        return true
    `);
    expect(lua.lua_toboolean(L53, -1)).toBe(true);

    run(L54, `
        assert(_VERSION == "Lua 5.4")
        assert(type(warn) == "function")
        assert(type(coroutine.close) == "function")
        assert(math.type(math.random(0)) == "integer")
        return true
    `);
    expect(lua.lua_toboolean(L54, -1)).toBe(true);

    lua.lua_close(L53);
    lua.lua_close(L54);
});

test('warn composes messages through lua_setwarnf', () => {
    let L = open("5.4");
    const seen = [];
    lua.lua_setwarnf(L, (ud, msg, tocont) => {
        expect(ud).toBe(null);
        seen.push([to_jsstring(msg), tocont]);
    }, null);

    run(L, `
        warn("a")
        warn("b", "c")
        warn(1)
        warn("@on")
    `);
    expect(seen).toEqual([
        ["a", false],
        ["b", true],
        ["c", false],
        ["1", false],
        ["@on", false]
    ]);

    run(L, `
        local ok, err = pcall(warn)
        assert(not ok and err:match("bad argument #1 to 'warn'"), err)
    `);
    lua.lua_close(L);
});

test('coroutine.close closes suspended, dead and failed threads', () => {
    let L = open("5.4");

    run(L, `
        local co = coroutine.create(function() coroutine.yield(1) end)
        assert(coroutine.resume(co))
        assert(coroutine.status(co) == "suspended")
        assert(coroutine.close(co) == true)
        assert(coroutine.status(co) == "dead")
        assert(coroutine.close(co) == true)

        local dead = coroutine.create(function() return 1 end)
        assert(coroutine.resume(dead))
        assert(coroutine.close(dead) == true)

        local failed = coroutine.create(function() error("boom") end)
        local ok, err = coroutine.resume(failed)
        assert(not ok and err:match("boom"))
        local closed, cerr = coroutine.close(failed)
        assert(closed == false and tostring(cerr):match("boom"))
        assert(coroutine.status(failed) == "dead")

        local running_ok, running_err = pcall(coroutine.close, coroutine.running())
        assert(not running_ok and running_err:match("cannot close a running coroutine"))

        local results = {}
        local outer
        outer = coroutine.create(function()
            local inner = coroutine.create(function()
                local cok, cerr = pcall(coroutine.close, outer)
                results[1], results[2] = cok, tostring(cerr)
            end)
            assert(coroutine.resume(inner))
        end)
        assert(coroutine.resume(outer))
        assert(results[1] == false)
        assert(results[2]:match("cannot close a normal coroutine"), results[2])
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});

test('5.4 <const> and <close> attributes', () => {
    let L = open("5.4");

    run(L, `
        local log = {}
        local mt = {
            __close = function(o, err)
                log[#log + 1] = tostring(o.n) .. ":" .. tostring(err)
            end
        }
        local function mk(n) return setmetatable({n = n}, mt) end

        -- const is read-only, including as an upvalue
        local c <const> = 10
        assert(c == 10)
        local f1, errc = load("local x <const> = 1; x = 2")
        assert(not f1 and errc:match("attempt to assign to const variable 'x'"), errc)
        local f2, errup = load("local x <const> = 1; return function() x = 2 end")
        assert(not f2 and errup:match("attempt to assign to const variable 'x'"), errup)

        -- block exit closes in reverse order
        do
            local a <close> = mk(1)
            local b <close> = mk(2)
        end
        assert(table.concat(log, ",") == "2:nil,1:nil", table.concat(log, ","))
        log = {}

        -- break and goto leave the scope
        for i = 1, 3 do
            local a <close> = mk(i)
            if i == 2 then break end
        end
        assert(table.concat(log, ",") == "1:nil,2:nil", table.concat(log, ","))
        log = {}
        do
            local a <close> = mk(1)
            goto done
        end
        ::done::
        assert(table.concat(log, ",") == "1:nil", table.concat(log, ","))
        log = {}

        -- return and nested blocks close before leaving
        local function f()
            local a <close> = mk(1)
            do
                local b <close> = mk(2)
                return 9
            end
        end
        assert(f() == 9)
        assert(table.concat(log, ",") == "2:nil,1:nil", table.concat(log, ","))
        log = {}

        -- tail calls close the current frame
        local function tail()
            local a <close> = mk(1)
            return (function() return 8 end)()
        end
        assert(tail() == 8)
        assert(table.concat(log, ",") == "1:nil", table.concat(log, ","))
        log = {}

        -- errors close with the error object, outer scopes stay open
        local ok, err = pcall(function()
            local a <close> = mk(1)
            pcall(function() error("inner") end)
            log[#log + 1] = "after"
            error("boom")
        end)
        assert(not ok and err:match("boom"))
        assert(log[1] == "after")
        assert(log[2]:match("^1:.*boom$"), log[2])

        -- nil/false are not closed and need no metamethod
        do
            local a <close> = nil
            local b <close> = false
        end

        -- non-closable values and multiple close variables are errors
        local fv, errv = load("local x <close> = 42")
        assert(fv, errv)
        local okv, rv = pcall(fv)
        assert(not okv and tostring(rv):match("got a non%-closable value"), rv)
        local ft, errt = load("local a <close>, b <close> = nil, nil")
        assert(not ft and errt:match("multiple to%-be%-closed variables"), errt)

        -- coroutine.close runs pending __close handlers
        log = {}
        local co = coroutine.create(function()
            local a <close> = mk(1)
            coroutine.yield(5)
        end)
        assert(coroutine.resume(co))
        assert(coroutine.close(co))
        assert(table.concat(log, ",") == "1:nil", table.concat(log, ","))
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);

    let L53 = open("5.3");
    run(L53, `
        local f, err = load("local x <const> = 1")
        assert(not f and err:match("unexpected symbol near '<'"), err)
        return true
    `);
    expect(lua.lua_toboolean(L53, -1)).toBe(true);

    lua.lua_close(L);
    lua.lua_close(L53);
});

test('math.random uses the 5.4 API and a per-state seed', () => {
    let L = open("5.4");

    run(L, `
        local s1, s2 = math.randomseed(1, 2)
        assert(s1 == 1 and s2 == 2)
        local a, b, c = math.random(), math.random(), math.random()
        math.randomseed(1, 2)
        assert(a == math.random() and b == math.random() and c == math.random())

        for i = 1, 2000 do
            local n = math.random(10, 20)
            assert(math.type(n) == "integer" and 10 <= n and n <= 20)
            local f = math.random()
            assert(math.type(f) == "float" and 0 <= f and f < 1)
        end

        assert(math.type(math.random(0)) == "integer")
        assert(not pcall(math.random, 2, 1))
        assert(not pcall(math.random, -1, -2))
        assert(not pcall(math.random, 1, 2, 3))

        local x, y = math.randomseed(9)
        assert(x == 9 and y == 0)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);

    let A = open("5.4");
    let B = open("5.4");

    run(A, "math.randomseed(11, 22) return math.random(), math.random()");
    const a1 = lua.lua_tonumber(A, -2);
    const a2 = lua.lua_tonumber(A, -1);

    run(B, "math.randomseed(33, 44) return math.random(), math.random()");
    run(A, "math.randomseed(11, 22) return math.random(), math.random()");
    expect(lua.lua_tonumber(A, -2)).toBe(a1);
    expect(lua.lua_tonumber(A, -1)).toBe(a2);

    lua.lua_close(L);
    lua.lua_close(A);
    lua.lua_close(B);
});
