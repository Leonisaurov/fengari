"use strict";

/* Runs a Lua file on Fengari and exits with its status. Used by diff-puc.js. */

const lua     = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib  = require("../src/lualib.js");
const { to_luastring, to_jsstring } = require("../src/fengaricore.js");

const file = process.argv[2];
if (!file) {
    console.error("usage: node scripts/run-lua.js <file.lua>");
    process.exit(2);
}

const L = lauxlib.luaL_newstate(process.env.LUA_PROFILE || undefined);
if (!L) {
    console.error("failed to create lua state");
    process.exit(2);
}

lualib.luaL_openlibs(L);

let status = lauxlib.luaL_loadfile(L, to_luastring(file));
if (status === lua.LUA_OK)
    status = lua.lua_pcall(L, 0, 0, 0);

if (status !== lua.LUA_OK) {
    lauxlib.luaL_traceback(L, L, lua.lua_tostring(L, -1), 1);
    const message = lua.lua_tostring(L, -1);
    console.error(message === null ? "error" : to_jsstring(message));
    process.exitCode = 1;
}
