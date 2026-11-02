"use strict";

/*
 * This file must set FENGARICONF before requiring fengari: luaconf reads it at
 * require time. Jest gives every test file its own module registry, and the
 * environment is restored after the file so later suites stay 32-bit.
 */
const previous = process.env.FENGARICONF;
process.env.FENGARICONF = JSON.stringify({LUA_INT64: true});

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");
const { to_luastring } = require("../src/fengaricore.js");

afterAll(() => {
    if (previous === undefined)
        delete process.env.FENGARICONF;
    else
        process.env.FENGARICONF = previous;
});

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

test("in-process LUA_INT64 integers and arithmetic", () => {
    let L = open();
    run(L, `
        return 9223372036854775807,
               9223372036854775807 + 1,
               9223372036854775806 * 2,
               -9223372036854775807 - 2,
               9223372036854775807 // 3,
               9223372036854775807 % 3,
               1 << 40, (1 << 40) >> 40,
               1 == 1.0, 1 < 2,
               tonumber("9223372036854775807"),
               tostring(2147483648)
    `);
    expect(lua.lua_tointeger(L, -12)).toBe(9223372036854775807n);
    expect(lua.lua_tointeger(L, -11)).toBe(-9223372036854775808n);
    expect(lua.lua_tointeger(L, -10)).toBe(-4n);
    expect(lua.lua_tointeger(L, -9)).toBe(9223372036854775807n);
    expect(lua.lua_tointeger(L, -8)).toBe(3074457345618258602n);
    expect(lua.lua_tointeger(L, -7)).toBe(1n);
    expect(lua.lua_tointeger(L, -6)).toBe(1099511627776n);
    expect(lua.lua_tointeger(L, -5)).toBe(1n);
    expect(lua.lua_toboolean(L, -4)).toBe(true);
    expect(lua.lua_toboolean(L, -3)).toBe(true);
    expect(lua.lua_tointeger(L, -2)).toBe(9223372036854775807n);
    expect(lua.lua_tojsstring(L, -1)).toBe("2147483648");
    lua.lua_close(L);
});

test("in-process LUA_INT64 libraries", () => {
    let L = open("5.4");
    run(L, `
        math.randomseed(1, 2)
        local r = math.random(10, 20)
        local p = string.pack("i8I8", -1, 9223372036854775807)
        local a, b = string.unpack("i8I8", p)
        local t = {}
        table.insert(t, 42)
        table.insert(t, 9223372036854775807)
        return r, math.abs(-9223372036854775807),
               math.ult(1, 2), math.fmod(9223372036854775807, 10),
               a, b, #p, t[1], t[2], table.concat(t, ",")
    `);
    let r = lua.lua_tointeger(L, -10);
    expect(r >= 10n && r <= 20n).toBe(true);
    expect(lua.lua_tointeger(L, -9)).toBe(9223372036854775807n);
    expect(lua.lua_toboolean(L, -8)).toBe(true);
    expect(lua.lua_tointeger(L, -7)).toBe(7n);
    expect(lua.lua_tointeger(L, -6)).toBe(-1n);
    expect(lua.lua_tointeger(L, -5)).toBe(9223372036854775807n);
    expect(lua.lua_tointeger(L, -4)).toBe(16n);
    expect(lua.lua_tointeger(L, -3)).toBe(42n);
    expect(lua.lua_tointeger(L, -2)).toBe(9223372036854775807n);
    expect(lua.lua_tojsstring(L, -1)).toBe("42,9223372036854775807");
    lua.lua_close(L);
});

test("in-process LUA_INT64 bytecode round trip", () => {
    let L = open();
    run(L, `
        local d = string.dump(function() return 9223372036854775807 end)
        local fn = assert(load(d))
        local a, b, c, e, f, g = string.byte(d, 1, 6)
        return a, b, c, e, f, g, fn()
    `);
    expect(lua.lua_tointeger(L, -7)).toBe(27n);
    expect(lua.lua_tointeger(L, -3)).toBe(83n);
    expect(lua.lua_tointeger(L, -2)).toBe(1n);
    expect(lua.lua_tointeger(L, -1)).toBe(9223372036854775807n);
    lua.lua_close(L);
});
