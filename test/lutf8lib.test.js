"use strict";

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");
const {to_luastring} = require("../src/fengaricore.js");

test('utf8.offset', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return utf8.offset("( ͡° ͜ʖ ͡° )", 5)
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tointeger(L, -1)).toBe(7);
});


test('utf8.codepoint', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return utf8.codepoint("( ͡° ͜ʖ ͡° )", 5, 8)
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tointeger(L, -3)).toBe(176);
    expect(lua.lua_tointeger(L, -2)).toBe(32);
    expect(lua.lua_tointeger(L, -1)).toBe(860);
});


test('utf8.char', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return utf8.char(40, 32, 865, 176, 32, 860, 662, 32, 865, 176, 32, 41)
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("( ͡° ͜ʖ ͡° )");
});


test('utf8.len', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return utf8.len("( ͡° ͜ʖ ͡° )")
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tointeger(L, -1)).toBe(12);
});


test('utf8.codes', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local s = "( ͡° ͜ʖ ͡° )"
        local results = ""
        for p, c in utf8.codes(s) do
            results = results .. "[" .. p .. "," .. c .. "] "
        end
        return results
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("[1,40] [2,32] [3,865] [5,176] [7,32] [8,860] [10,662] [12,32] [13,865] [15,176] [17,32] [18,41] ");
});


test('utf8 invalid sequences and edge positions', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local bad = "a" .. string.char(0xE2, 0x28, 0xA1) .. "z"

        local n, pos = utf8.len(bad)
        assert(n == nil and pos == 2)

        local ok, err = pcall(utf8.codepoint, bad, 2)
        assert(not ok and err:match("invalid UTF%-8 code"), err)

        local ok2, err2 = pcall(function()
            for _ in utf8.codes(bad) do end
        end)
        assert(not ok2 and err2:match("invalid UTF%-8 code"), err2)

        local s = "aé€"
        assert(utf8.offset(s, 0, 2) == 2)
        assert(utf8.offset(s, -1, 4) == 2)
        assert(utf8.offset(s, 2, 1) == 2)
        assert(utf8.offset(s, 4, 1) == 7)

        assert(not pcall(utf8.char, -1))
        assert(not pcall(utf8.char, 0x110000))
        assert(#utf8.char(0x10FFFF) == 4)
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});
