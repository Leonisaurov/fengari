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

test("in-process LUA_INT64 library paths keep BigInt values", () => {
    let L = open("5.4");
    run(L, `
        -- string formatting and byte/char conversions
        assert(string.format("%d", 9223372036854775807) == "9223372036854775807")
        assert(string.format("%x", 255) == "ff")
        assert(string.byte("A") == 65)
        assert(string.char(65) == "A")
        assert(#"abc" == 3)

        -- table helpers sorting, moving and removing big integers
        local t = {9223372036854775807, 1, 9223372036854775806}
        table.sort(t)
        assert(t[1] == 1 and t[2] == 9223372036854775806 and
               t[3] == 9223372036854775807)
        table.insert(t, 2, 42)
        assert(table.remove(t, 2) == 42)
        local u = table.move(t, 1, #t, 1, {})
        assert(#u == #t and u[1] == t[1])
        assert(table.concat(t, ",") ==
               "1,9223372036854775806,9223372036854775807")

        -- math helpers
        assert(math.max(1, 9223372036854775807) == 9223372036854775807)
        assert(math.min(1, -9223372036854775807) == -9223372036854775807)
        assert(math.type(9223372036854775807) == "integer")
        assert(math.type(1.5) == "float")
        assert(math.tointeger(3.0) == 3)
        assert(math.floor(3.7) == 3)
        assert(math.ceil(3.2) == 4)

        -- utf8 and base conversion
        assert(utf8.char(65) == "A")
        assert(utf8.codepoint("A") == 65)
        assert(tonumber("ff", 16) == 255)

        -- integer table keys through rawget/rawset and next
        local k = {}
        rawset(k, 9223372036854775807, "x")
        assert(rawget(k, 9223372036854775807) == "x")
        local nk = {}
        nk[9223372036854775807] = true
        assert(next(nk) == 9223372036854775807)

        -- os.time keeps the integer subtype
        local now = os.time()
        assert(math.type(now) == "integer")
        assert(type(os.date("%Y", now)) == "string")

        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});

test("in-process LUA_INT64 string positions and limits", () => {
    let L = open("5.4");
    run(L, `
        -- %q, %c, repetition and slicing
        assert(string.format("%q", 9223372036854775807) ==
               "9223372036854775807")
        assert(string.format("%c", 65) == "A")
        assert(string.rep("ab", 3) == "ababab")
        assert(string.sub("abcdef", 2, 4) == "bcd")
        assert(string.byte("ABC", 1) == 65)

        -- find/gsub/gmatch with integer positions and counts
        local a, b = string.find("abcabc", "bc")
        assert(a == 2 and b == 3)
        assert(string.find("abcabc", "bc", 3) == 5)
        assert(string.gsub("aaaa", "a", "b", 2) == "bbaa")
        assert(string.gsub("aaaa", "a", "b", 9223372036854775807) == "bbbb")
        local count = 0
        for _ in string.gmatch("a,b,c", "[^,]+") do count = count + 1 end
        assert(count == 3)

        -- select indices and table.unpack ranges
        assert(select("#", 1, 2, 3) == 3)
        assert(select(2, "a", "b", "c") == "b")
        local x, y = table.unpack({10, 20}, 1, 2)
        assert(x == 10 and y == 20)

        -- utf8 offsets and lengths
        assert(utf8.len("aé") == 2)
        assert(utf8.offset("aé", 2) == 2)
        assert(utf8.char(233) == "é")

        -- os.date accepts integer timestamps
        local t = os.time({year = 2020, month = 1, day = 2, hour = 3,
                           min = 4, sec = 5})
        assert(math.type(t) == "integer")
        assert(os.date("%Y-%m-%d", t) == "2020-01-02")

        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});
