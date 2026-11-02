"use strict";

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");
const { to_luastring } = require("../src/fengaricore.js");

const open = function(version) {
    let L = lauxlib.luaL_newstate(version);
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    return L;
};

const dump = function(version) {
    let L = open(version);
    expect(lauxlib.luaL_loadstring(L,
        to_luastring("return string.dump(function() return 7 end)")))
        .toBe(lua.LUA_OK);
    expect(lua.lua_pcall(L, 0, 1, 0)).toBe(lua.LUA_OK);
    let bytes = Uint8Array.from(lua.lua_tostring(L, -1));
    lua.lua_close(L);
    return bytes;
};

const load = function(version, bytes, mode) {
    let L = open(version);
    let status = lauxlib.luaL_loadbufferx(L, bytes, bytes.length,
        to_luastring("=chunk"), mode ? to_luastring(mode) : null);
    if (status !== lua.LUA_OK) {
        let message = lua.lua_tojsstring(L, -1);
        lua.lua_close(L);
        return {ok: false, message: message};
    }
    status = lua.lua_pcall(L, 0, 1, 0);
    let value = status === lua.LUA_OK ? lua.lua_tonumber(L, -1) : null;
    let message = status === lua.LUA_OK ? null : lua.lua_tojsstring(L, -1);
    lua.lua_close(L);
    return {ok: status === lua.LUA_OK, value: value, message: message};
};

test("each profile writes its own bytecode signature", () => {
    expect(dump("5.1")[4]).toBe(0x51);
    expect(dump("5.2")[4]).toBe(0x52);
    expect(dump("5.3")[4]).toBe(0x53);
    expect(dump("5.4")[4]).toBe(0x54);
});

test("each profile loads its own bytecode", () => {
    for (const version of ["5.1", "5.2", "5.3", "5.4"]) {
        const result = load(version, dump(version));
        expect(result.ok).toBe(true);
        expect(result.value).toBe(7);
    }
});

test("incompatible bytecode versions are rejected", () => {
    for (const from of ["5.1", "5.2", "5.3", "5.4"]) {
        const bytes = dump(from);
        for (const to of ["5.1", "5.2", "5.3", "5.4"]) {
            if (from === to) continue;
            const result = load(to, bytes);
            expect(result.ok).toBe(false);
            expect(result.message).toMatch(/version mismatch/);
        }
    }
});

test("loadbufferx text/binary mode is respected per profile", () => {
    const bytes = dump("5.2");
    expect(load("5.2", bytes, "t").ok).toBe(false);
    expect(load("5.2", bytes, "b").ok).toBe(true);
});
