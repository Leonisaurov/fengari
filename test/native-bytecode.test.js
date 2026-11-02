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

const load_bytes = function(L, bytes) {
    return lauxlib.luaL_loadbufferx(L, bytes, bytes.length,
        to_luastring("=native"), null);
};

const call_function = function(L, file, nresults) {
    nresults = nresults === undefined ? 7 : nresults;
    let status = load_chunk(L, file);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    status = lua.lua_pcall(L, 0, 1, 0);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    lua.lua_pushinteger(L, 10);
    lua.lua_pushinteger(L, 2);
    status = lua.lua_pcall(L, 2, nresults, 0);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    let values = [];
    for (let i = 1; i <= lua.lua_gettop(L); i++)
        values.push(lua.lua_tojsstring(L, i));
    return {ok: true, values: values};
};

const call_main = function(L, file) {
    let status = load_chunk(L, file);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    status = lua.lua_pcall(L, 0, 1, 0);
    if (status !== lua.LUA_OK)
        return {ok: false, message: lua.lua_tojsstring(L, -1)};
    return {ok: true, value: lua.lua_tojsstring(L, -1)};
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

test("PUC Lua 5.1 closures, jumps and upvalues translate", () => {
    let L = open("5.1");
    try {
        expect(call_function(L, path.join(FIXTURES, "lua51_features.luac"), 14))
            .toEqual({ok: true, values: ["242.0", "14520.0", "127.0", "31.0",
                "6.0", "12.0", "15.0", "40.0", "9.0", "3.0", "10.0", "abc",
                "42.0", "T"]});
    } finally {
        lua.lua_close(L);
    }
});

test("PUC Lua 5.2 closures, jumps and upvalues translate", () => {
    let L = open("5.2");
    try {
        expect(call_function(L, path.join(FIXTURES, "lua52_features.luac"), 14))
            .toEqual({ok: true, values: ["242.0", "14520.0", "127.0", "31.0",
                "6.0", "12.0", "15.0", "40.0", "9.0", "3.0", "10.0", "abc",
                "42.0", "T"]});
    } finally {
        lua.lua_close(L);
    }
});

test("PUC Lua 5.1 SETLIST block numbers beyond C translate", () => {
    let L = open("5.1");
    try {
        expect(call_main(L, path.join(FIXTURES, "lua51_setlist.luac")))
            .toEqual({ok: true, value: "2.0"});
    } finally {
        lua.lua_close(L);
    }
});

test("PUC Lua 5.2 SETLIST EXTRAARG blocks translate", () => {
    let L = open("5.2");
    try {
        expect(call_main(L, path.join(FIXTURES, "lua52_setlist.luac")))
            .toEqual({ok: true, value: "2.0"});
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

test("native chunks reject malformed headers", () => {
    let valid = fs.readFileSync(path.join(FIXTURES, "lua51.luac"));
    const check = function(mutate, pattern) {
        let L = open("5.1");
        try {
            let bytes = Buffer.from(valid);
            mutate(bytes);
            expect(load_bytes(L, bytes)).not.toBe(lua.LUA_OK);
            expect(lua.lua_tojsstring(L, -1)).toMatch(pattern);
        } finally {
            lua.lua_close(L);
        }
    };

    check((b) => { b[1] = 0x78; }, /not a/);           /* signature */
    check((b) => { b[5] = 1; }, /format mismatch/);    /* header format */
    check((b) => { b[7] = 8; }, /incompatible/);       /* int size */
    check((b) => { b[9] = 8; }, /incompatible/);       /* instruction size */
    check((b) => { b[10] = 4; }, /incompatible/);      /* number size */
    check((b) => { b[11] = 1; }, /incompatible/);      /* integral flag */
});

test("native chunks reject truncated data", () => {
    for (const [file, version] of [["lua51.luac", "5.1"],
        ["lua52.luac", "5.2"]]) {
        let L = open(version);
        try {
            let valid = fs.readFileSync(path.join(FIXTURES, file));
            expect(load_bytes(L, valid.subarray(0, 20))).not.toBe(lua.LUA_OK);
            expect(lua.lua_tojsstring(L, -1)).toMatch(/truncated/);
        } finally {
            lua.lua_close(L);
        }
    }
});
