"use strict";

/*
** Opt-in LuaJIT-compatible `bit` library.
**
** Enable it with FENGARICONF='{"LUAJIT_BIT":true}'. Results are signed
** 32-bit integers, like LuaJIT's bit library (unlike Lua 5.2's bit32).
*/

const {
    lua_gettop,
    lua_pushinteger,
    lua_pushstring
} = require('./lua.js');
const {
    luaL_checknumber,
    luaL_newlib,
    luaL_optinteger
} = require('./lauxlib.js');
const { to_luastring } = require('./fengaricore.js');

const tobit = function(n) {
    return n | 0;
};

const pushbit = function(L, x) {
    lua_pushinteger(L, x | 0);
    return 1;
};

const b_tobit = function(L) {
    return pushbit(L, tobit(luaL_checknumber(L, 1)));
};

const b_bnot = function(L) {
    return pushbit(L, ~tobit(luaL_checknumber(L, 1)));
};

const b_band = function(L) {
    let r = tobit(luaL_checknumber(L, 1));
    const n = lua_gettop(L);
    for (let i = 2; i <= n; i++)
        r &= tobit(luaL_checknumber(L, i));
    return pushbit(L, r);
};

const b_bor = function(L) {
    let r = tobit(luaL_checknumber(L, 1));
    const n = lua_gettop(L);
    for (let i = 2; i <= n; i++)
        r |= tobit(luaL_checknumber(L, i));
    return pushbit(L, r);
};

const b_bxor = function(L) {
    let r = tobit(luaL_checknumber(L, 1));
    const n = lua_gettop(L);
    for (let i = 2; i <= n; i++)
        r ^= tobit(luaL_checknumber(L, i));
    return pushbit(L, r);
};

const b_lshift = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    const n = tobit(luaL_checknumber(L, 2)) & 31;
    return pushbit(L, x << n);
};

const b_rshift = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    const n = tobit(luaL_checknumber(L, 2)) & 31;
    return pushbit(L, x >>> n);
};

const b_arshift = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    const n = tobit(luaL_checknumber(L, 2)) & 31;
    return pushbit(L, x >> n);
};

const b_rol = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    const n = tobit(luaL_checknumber(L, 2)) & 31;
    return pushbit(L, n === 0 ? x : ((x << n) | (x >>> (32 - n))));
};

const b_ror = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    const n = tobit(luaL_checknumber(L, 2)) & 31;
    return pushbit(L, n === 0 ? x : ((x >>> n) | (x << (32 - n))));
};

const b_bswap = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    return pushbit(L,
        ((x & 0xff) << 24) |
        ((x & 0xff00) << 8) |
        ((x >>> 8) & 0xff00) |
        ((x >>> 24) & 0xff));
};

const b_tohex = function(L) {
    const x = tobit(luaL_checknumber(L, 1));
    let n = luaL_optinteger(L, 2, 8);
    if (typeof n === "bigint") n = Number(n);
    let upper = false;
    if (n < 0) {
        upper = true;
        n = -n;
    }
    let s = (x >>> 0).toString(16).padStart(8, "0");
    if (n > 8)
        s = s.padStart(n, "0");
    else
        s = s.slice(8 - n);
    if (upper) s = s.toUpperCase();
    lua_pushstring(L, to_luastring(s));
    return 1;
};

const bitlib = {
    "tobit":   b_tobit,
    "tohex":   b_tohex,
    "bnot":    b_bnot,
    "band":    b_band,
    "bor":     b_bor,
    "bxor":    b_bxor,
    "lshift":  b_lshift,
    "rshift":  b_rshift,
    "arshift": b_arshift,
    "rol":     b_rol,
    "ror":     b_ror,
    "bswap":   b_bswap
};

const luaopen_bit = function(L) {
    luaL_newlib(L, bitlib);
    return 1;
};

module.exports.luaopen_bit = luaopen_bit;
