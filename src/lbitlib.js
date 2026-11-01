"use strict";

/*
** bit32 library for the Lua 5.2 profile. Lua 5.3 removed it in favour of
** bitwise operators, so it is only installed by the 5.2 implementation.
*/

const {
    lua_gettop,
    lua_pushboolean,
    lua_pushnumber
} = require('./lua.js');
const {
    luaL_argcheck,
    luaL_checknumber,
    luaL_newlib,
    luaL_optinteger
} = require('./lauxlib.js');

const U32 = 0xFFFFFFFF;

const checkuint = function(L, arg) {
    return luaL_checknumber(L, arg) >>> 0;
};

const checkdisp = function(L, arg) {
    return Math.trunc(luaL_checknumber(L, arg));
};

const band = function(L) {
    let r = U32;
    const n = lua_gettop(L);
    for (let i = 1; i <= n; i++)
        r = (r & checkuint(L, i)) >>> 0;
    lua_pushnumber(L, r);
    return 1;
};

const bor = function(L) {
    let r = 0;
    const n = lua_gettop(L);
    for (let i = 1; i <= n; i++)
        r = (r | checkuint(L, i)) >>> 0;
    lua_pushnumber(L, r);
    return 1;
};

const bxor = function(L) {
    let r = 0;
    const n = lua_gettop(L);
    for (let i = 1; i <= n; i++)
        r = (r ^ checkuint(L, i)) >>> 0;
    lua_pushnumber(L, r);
    return 1;
};

const bnot = function(L) {
    lua_pushnumber(L, (~checkuint(L, 1)) >>> 0);
    return 1;
};

const btest = function(L) {
    let r = U32;
    const n = lua_gettop(L);
    for (let i = 1; i <= n; i++)
        r = (r & checkuint(L, i)) >>> 0;
    lua_pushboolean(L, r !== 0);
    return 1;
};

const lshift = function(L) {
    const x = checkuint(L, 1);
    const disp = checkdisp(L, 2);
    if (disp <= -32 || disp >= 32)
        lua_pushnumber(L, 0);
    else if (disp < 0)
        lua_pushnumber(L, (x >>> -disp) >>> 0);
    else
        lua_pushnumber(L, (x << disp) >>> 0);
    return 1;
};

const rshift = function(L) {
    const x = checkuint(L, 1);
    const disp = checkdisp(L, 2);
    if (disp <= -32 || disp >= 32)
        lua_pushnumber(L, 0);
    else if (disp < 0)
        lua_pushnumber(L, (x << -disp) >>> 0);
    else
        lua_pushnumber(L, (x >>> disp) >>> 0);
    return 1;
};

const arshift = function(L) {
    const x = checkuint(L, 1);
    const disp = checkdisp(L, 2);
    if (disp <= -32 || disp >= 32)
        lua_pushnumber(L, (x & 0x80000000) ? U32 : 0);
    else if (disp < 0)
        lua_pushnumber(L, (x << -disp) >>> 0);
    else
        lua_pushnumber(L, ((x | 0) >> disp) >>> 0);
    return 1;
};

const fieldmask = function(width) {
    return width === 32 ? U32 : ((1 << width) - 1) >>> 0;
};

const extract = function(L) {
    const n = checkuint(L, 1);
    const field = checkdisp(L, 2);
    const width = luaL_optinteger(L, 3, 1);
    luaL_argcheck(L, field >= 0, 2, "field cannot be negative");
    luaL_argcheck(L, width > 0, 3, "width must be positive");
    luaL_argcheck(L, field + width <= 32, 3, "trying to access non-existent bits");
    lua_pushnumber(L, ((n >>> field) & fieldmask(width)) >>> 0);
    return 1;
};

const replace = function(L) {
    const n = checkuint(L, 1);
    const v = checkuint(L, 2);
    const field = checkdisp(L, 3);
    const width = luaL_optinteger(L, 4, 1);
    luaL_argcheck(L, field >= 0, 3, "field cannot be negative");
    luaL_argcheck(L, width > 0, 4, "width must be positive");
    luaL_argcheck(L, field + width <= 32, 4, "trying to access non-existent bits");
    const mask = (fieldmask(width) << field) >>> 0;
    lua_pushnumber(L, ((n & ~mask) | ((v << field) & mask)) >>> 0);
    return 1;
};

const lrotate = function(L) {
    const n = checkuint(L, 1);
    let disp = checkdisp(L, 2) % 32;
    if (disp < 0) disp += 32;
    lua_pushnumber(L, ((n << disp) | (n >>> (32 - disp))) >>> 0);
    return 1;
};

const rrotate = function(L) {
    const n = checkuint(L, 1);
    let disp = checkdisp(L, 2) % 32;
    if (disp < 0) disp += 32;
    lua_pushnumber(L, ((n >>> disp) | (n << (32 - disp))) >>> 0);
    return 1;
};

const bitlib = {
    "arshift": arshift,
    "band":    band,
    "bnot":    bnot,
    "bor":     bor,
    "btest":   btest,
    "bxor":    bxor,
    "extract": extract,
    "lrotate": lrotate,
    "lshift":  lshift,
    "replace": replace,
    "rrotate": rrotate,
    "rshift":  rshift
};

const luaopen_bit32 = function(L) {
    luaL_newlib(L, bitlib);
    return 1;
};

module.exports.luaopen_bit32 = luaopen_bit32;
