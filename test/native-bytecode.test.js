"use strict";

const fs = require("fs");
const path = require("path");

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");
const { to_luastring } = require("../src/fengaricore.js");

const FIXTURES = path.join(__dirname, "fixtures");

const open = function(version) {
    let L = lauxlib.luaL_newstate(version);
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    return L;
};

const load_chunk = function(L, file) {
    let bytes = fs.readFileSync(file);
    return lauxlib.luaL_loadbufferx(L, bytes, bytes.length,
        to_luastring("=native"), null);
};

const call_function = function(L, file) {
    let status = load_chunk(L, file);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    status = lua.lua_pcall(L, 0, 1, 0);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    lua.lua_pushinteger(L, 10);
    lua.lua_pushinteger(L, 2);
    status = lua.lua_pcall(L, 2, 7, 0);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    let values = [];
    for (let i = -7; i <= -1; i++)
        values.push(lua.lua_tojsstring(L, i));
    return {ok: true, values: values};
};

test("PUC Lua 5.1 binary chunks load natively", () => {
    let L = open("5.1");
    try {
        expect(call_function(L, path.join(FIXTURES, "lua51.luac")))
            .toEqual({ok: true, values: ["12.0", "6.0", "5.0", "X",
                "16.0", "6.0", "6.0"]});
    } finally {
        lua.lua_close(L);
    }
});

test("PUC Lua 5.2 binary chunks load natively", () => {
    let L = open("5.2");
    try {
        expect(call_function(L, path.join(FIXTURES, "lua52.luac")))
            .toEqual({ok: true, values: ["12.0", "6.0", "5.0", "X",
                "16.0", "6.0", "6.0"]});
    } finally {
        lua.lua_close(L);
    }
});

test("native chunks are rejected by the wrong profile", () => {
    let L51 = open("5.1");
    try {
        let result = call_function(L51, path.join(FIXTURES, "lua52.luac"));
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/version mismatch/);
    } finally {
        lua.lua_close(L51);
    }

    let L52 = open("5.2");
    try {
        let result = call_function(L52, path.join(FIXTURES, "lua51.luac"));
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/version mismatch/);
    } finally {
        lua.lua_close(L52);
    }
});
