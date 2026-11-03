"use strict";

/*
 * The LuaJIT `bit` extension is opt-in at require time because luaconf reads
 * FENGARICONF when it is loaded.
 */
const previous = process.env.FENGARICONF;
process.env.FENGARICONF = JSON.stringify({ LUAJIT_BIT: true });

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

const run = function(code) {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
    let result = lua.lua_toboolean(L, -1);
    lua.lua_close(L);
    return result;
};

test("LuaJIT bit operations match the reference behaviour", () => {
    expect(run(`
        assert(type(bit) == "table" and require("bit") == bit)
        assert(bit.tobit(0xFFFFFFFF) == -1)
        assert(bit.tobit(2^32 + 5) == 5)
        assert(bit.bnot(0) == -1)
        assert(bit.band(0xF0F0, 0xFF00) == 0xF000)
        assert(bit.bor(1, 2, 4) == 7)
        assert(bit.bxor(0xFF, 0x0F) == 0xF0)
        assert(bit.lshift(1, 31) == -2147483648)
        assert(bit.lshift(1, 32) == 1)
        assert(bit.rshift(-1, 1) == 2147483647)
        assert(bit.arshift(-8, 1) == -4)
        assert(bit.rol(0x12345678, 8) == 0x34567812)
        assert(bit.ror(0x12345678, 8) == 0x78123456)
        assert(bit.bswap(0x12345678) == 0x78563412)
        assert(bit.tohex(0x12345678) == "12345678")
        assert(bit.tohex(0xABCDEF, 4) == "cdef")
        assert(bit.tohex(0xABCDEF, -4) == "CDEF")
        assert(bit.tohex(0x12345678, 9) == "012345678")
        assert(bit.tohex(0, 0) == "")
        assert(not pcall(bit.band))
        assert(not pcall(bit.bor))
        assert(not pcall(bit.bxor))
        return true
    `)).toBe(true);
});

test("bit results are signed 32-bit integers", () => {
    expect(run(`
        assert(math.type(bit.bnot(0)) == "integer")
        assert(bit.bnot(0) == -1)
        assert(bit.band(0xFFFFFFFF, 0xFFFFFFFF) == -1)
        assert(bit.tohex(-1) == "ffffffff")
        return true
    `)).toBe(true);
});
