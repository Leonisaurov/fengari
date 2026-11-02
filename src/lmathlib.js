"use strict";

const {
    LUA_OPLT,
    LUA_TNUMBER,
    lua_compare,
    lua_gettop,
    lua_isinteger,
    lua_isnone,
    lua_isnoneornil,
    lua_pushboolean,
    lua_pushinteger,
    lua_pushliteral,
    lua_pushnil,
    lua_pushnumber,
    lua_pushvalue,
    lua_setfield,
    lua_settop,
    lua_tointeger,
    lua_tointegerx,
    lua_type
} = require('./lua.js');
const {
    luaL_argcheck,
    luaL_argerror,
    luaL_checkany,
    luaL_checkinteger,
    luaL_checknumber,
    luaL_error,
    luaL_newlib,
    luaL_optinteger,
    luaL_optnumber
} = require('./lauxlib.js');
const {
    LUA_MAXINTEGER,
    LUA_MININTEGER,
    lua_numbertointeger
} = require('./luaconf.js');
const { to_luastring } = require("./fengaricore.js");

let rand_state;
/* use same parameters as glibc LCG */
const l_rand = function() {
    /* Math.imul keeps the multiplication exact in 32-bit; a plain `*` loses
       precision once the state no longer fits in 53 bits. */
    rand_state = (Math.imul(1103515245, rand_state) + 12345) & 0x7fffffff;
    return rand_state;
};
const l_srand = function(x) {
    rand_state = x|0;
    if (rand_state === 0)
        rand_state = 1;
};

const next_random64 = function() {
    if (rand_state === void 0) {
        let hi = Math.floor(Math.random() * 0x100000000) >>> 0;
        let lo = Math.floor(Math.random() * 0x100000000) >>> 0;
        return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
    }
    return BigInt.asIntN(64, (BigInt(l_rand()) << 32n) | BigInt(l_rand()));
};

const math_random = function(L) {
    let low, up;
    /* use Math.random until randomseed is called */
    let r = (rand_state === void 0)?Math.random():(l_rand() / 0x80000000);
    switch (lua_gettop(L)) {  /* check number of arguments */
        case 0:
            lua_pushnumber(L, r);  /* Number between 0 and 1 */
            return 1;
        case 1: {
            low = 1;
            up = luaL_checkinteger(L, 1);
            break;
        }
        case 2: {
            low = luaL_checkinteger(L, 1);
            up = luaL_checkinteger(L, 2);
            break;
        }
        default: return luaL_error(L, "wrong number of arguments");
    }

    if (typeof low === "bigint" || typeof up === "bigint") {
        low = BigInt(low);
        up = BigInt(up);
        luaL_argcheck(L, low <= up, 1, "interval is empty");
        let range = up - low + 1n;
        let limit = (1n << 64n) / range * range;
        let rv = next_random64();
        while (BigInt.asUintN(64, rv) >= limit)
            rv = next_random64();
        lua_pushinteger(L, BigInt.asIntN(64,
            low + (BigInt.asUintN(64, rv) % range)));
        return 1;
    }

    /* random integer in the interval [low, up] */
    luaL_argcheck(L, low <= up, 1, "interval is empty");
    luaL_argcheck(L, low >= 0 || up <= LUA_MAXINTEGER + low, 1,
        "interval too large");

    r *= (up - low) + 1;
    lua_pushinteger(L, Math.floor(r) + low);
    return 1;
};

const math_randomseed = function(L) {
    l_srand(luaL_checknumber(L, 1));
    l_rand(); /* discard first value to avoid undesirable correlations */
    return 0;
};

/* ---------------------------------------------------------------------- */
/* Lua 5.4 math.random: xoshiro128** with a per-state seed               */
/* ---------------------------------------------------------------------- */

const U32 = 0x100000000;

const rotl32 = function(x, k) {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
};

const mix32 = function(x) {
    x = (x + 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
};

const next54 = function(L) {
    const g = L.l_G;
    if (g.rand54 === null)
        seed54(L, (Date.now() ^ Math.floor(Math.random() * U32)) >>> 0,
            Math.floor(Math.random() * U32) >>> 0);
    const s = g.rand54;
    const result = Math.imul(rotl32(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl32(s[3], 11);
    return result;
};

const seed54 = function(L, n1, n2) {
    let s = (n1 ^ Math.imul(n2, 0x9e3779b9)) >>> 0;
    const state = new Array(4);
    for (let i = 0; i < 4; i++) {
        s = (s + 0x9e3779b9) >>> 0;
        state[i] = mix32(s ^ Math.imul(i + 1, 0x85ebca6b));
    }
    L.l_G.rand54 = state;
    /* discard initial values to spread the seed */
    for (let i = 0; i < 16; i++)
        next54(L);
};

const next64_54 = function(L) {
    return BigInt.asIntN(64,
        (BigInt(next54(L)) << 32n) | BigInt(next54(L)));
};

const math_random54 = function(L) {
    let r = next54(L);
    let low, up;
    switch (lua_gettop(L)) {
        case 0:
            lua_pushnumber(L, r / U32);  /* float in [0, 1) */
            return 1;
        case 1:
            low = 1;
            up = luaL_checkinteger(L, 1);
            if (up === 0 || up === 0n) {  /* full random integer */
                if (typeof up === "bigint")
                    lua_pushinteger(L, next64_54(L));
                else
                    lua_pushinteger(L, r | 0);
                return 1;
            }
            break;
        case 2:
            low = luaL_checkinteger(L, 1);
            up = luaL_checkinteger(L, 2);
            break;
        default:
            return luaL_error(L, "wrong number of arguments");
    }

    if (typeof low === "bigint" || typeof up === "bigint") {
        low = BigInt(low);
        up = BigInt(up);
        luaL_argcheck(L, low <= up, 1, "interval is empty");
        let range = up - low + 1n;
        let limit = (1n << 64n) / range * range;
        let rv = next64_54(L);
        while (BigInt.asUintN(64, rv) >= limit)
            rv = next64_54(L);
        lua_pushinteger(L, BigInt.asIntN(64,
            low + (BigInt.asUintN(64, rv) % range)));
        return 1;
    }

    luaL_argcheck(L, low <= up, 1, "interval is empty");
    let range = up - low + 1;  /* at most 2^32 */
    let limit = Math.floor(U32 / range) * range;
    while (r >= limit)
        r = next54(L);
    lua_pushinteger(L, low + (r % range));
    return 1;
};

const math_randomseed54 = function(L) {
    let n1, n2;
    if (lua_isnone(L, 1)) {
        n1 = (Date.now() ^ Math.floor(Math.random() * U32)) >>> 0;
        n2 = Math.floor(Math.random() * U32) >>> 0;
    } else {
        n1 = luaL_checkinteger(L, 1);
        n2 = luaL_optinteger(L, 2, 0);
    }
    seed54(L,
        Number(BigInt.asUintN(32, BigInt(n1))),
        Number(BigInt.asUintN(32, BigInt(n2))));
    lua_pushinteger(L, n1);
    lua_pushinteger(L, n2);
    return 2;
};

const math_abs = function(L) {
    if (lua_isinteger(L, 1)) {
        let n = lua_tointeger(L, 1);
        if (typeof n === "bigint")
            n = n < 0n ? BigInt.asIntN(64, -n) : n;
        else if (n < 0)
            n = (-n)|0;
        lua_pushinteger(L, n);
    }
    else
        lua_pushnumber(L, Math.abs(luaL_checknumber(L, 1)));
    return 1;
};

const math_sin = function(L) {
    lua_pushnumber(L, Math.sin(luaL_checknumber(L, 1)));
    return 1;
};

const math_cos = function(L) {
    lua_pushnumber(L, Math.cos(luaL_checknumber(L, 1)));
    return 1;
};

const math_tan = function(L) {
    lua_pushnumber(L, Math.tan(luaL_checknumber(L, 1)));
    return 1;
};

const math_asin = function(L) {
    lua_pushnumber(L, Math.asin(luaL_checknumber(L, 1)));
    return 1;
};

const math_acos = function(L) {
    lua_pushnumber(L, Math.acos(luaL_checknumber(L, 1)));
    return 1;
};

const math_atan = function(L) {
    let y = luaL_checknumber(L, 1);
    let x = luaL_optnumber(L, 2, 1);
    lua_pushnumber(L, Math.atan2(y, x));
    return 1;
};

const math_toint = function(L) {
    let n = lua_tointegerx(L, 1);
    if (n !== false)
        lua_pushinteger(L, n);
    else {
        luaL_checkany(L, 1);
        lua_pushnil(L);  /* value is not convertible to integer */
    }
    return 1;
};

const pushnumint = function(L, d) {
    let n = lua_numbertointeger(d);
    if (n !== false)  /* does 'd' fit in an integer? */
        lua_pushinteger(L, n);  /* result is integer */
    else
        lua_pushnumber(L, d);  /* result is float */
};

const math_floor = function(L) {
    if (lua_isinteger(L, 1))
        lua_settop(L, 1);
    else
        pushnumint(L, Math.floor(luaL_checknumber(L, 1)));

    return 1;
};

const math_ceil = function(L) {
    if (lua_isinteger(L, 1))
        lua_settop(L, 1);
    else
        pushnumint(L, Math.ceil(luaL_checknumber(L, 1)));

    return 1;
};

const math_sqrt = function(L) {
    lua_pushnumber(L, Math.sqrt(luaL_checknumber(L, 1)));
    return 1;
};

const math_ult = function(L) {
    let a = luaL_checkinteger(L, 1);
    let b = luaL_checkinteger(L, 2);
    if (typeof a === "bigint")
        lua_pushboolean(L, BigInt.asUintN(64, a) < BigInt.asUintN(64, b));
    else
        lua_pushboolean(L, (a >= 0)?(b<0 || a<b):(b<0 && a<b));
    return 1;
};

const math_log = function(L) {
    let x = luaL_checknumber(L, 1);
    let res;
    if (Number.isNaN(x))
        res = x;  /* preserve the NaN sign, like C libm */
    else if (x < 0)
        res = -NaN;  /* PUC's log of a negative value is -nan */
    else if (lua_isnoneornil(L, 2))
        res = Math.log(x);
    else {
        let base = luaL_checknumber(L, 2);
        if (base === 2)
            res = Math.log2(x);
        else if (base === 10)
            res = Math.log10(x);
        else
            res = Math.log(x)/Math.log(base);
    }
    lua_pushnumber(L, res);
    return 1;
};

const math_exp = function(L) {
    lua_pushnumber(L, Math.exp(luaL_checknumber(L, 1)));
    return 1;
};

const math_deg = function(L) {
    lua_pushnumber(L, luaL_checknumber(L, 1) * (180 / Math.PI));
    return 1;
};

const math_rad = function(L) {
    lua_pushnumber(L, luaL_checknumber(L, 1) * (Math.PI / 180));
    return 1;
};

const math_min = function(L) {
    let n = lua_gettop(L);  /* number of arguments */
    let imin = 1;  /* index of current minimum value */
    luaL_argcheck(L, n >= 1, 1, "value expected");
    for (let i = 2; i <= n; i++){
        if (lua_compare(L, i, imin, LUA_OPLT))
            imin = i;
    }
    lua_pushvalue(L, imin);
    return 1;
};

const math_max = function(L) {
    let n = lua_gettop(L);  /* number of arguments */
    let imax = 1;  /* index of current minimum value */
    luaL_argcheck(L, n >= 1, 1, "value expected");
    for (let i = 2; i <= n; i++){
        if (lua_compare(L, imax, i, LUA_OPLT))
            imax = i;
    }
    lua_pushvalue(L, imax);
    return 1;
};

const math_type = function(L) {
    if (lua_type(L, 1) === LUA_TNUMBER) {
        if (lua_isinteger(L, 1))
            lua_pushliteral(L, "integer");
        else
            lua_pushliteral(L, "float");
    } else {
        luaL_checkany(L, 1);
        lua_pushnil(L);
    }
    return 1;
};

const math_fmod = function(L) {
    if (lua_isinteger(L, 1) && lua_isinteger(L, 2)) {
        let d = lua_tointeger(L, 2);
        let a = lua_tointeger(L, 1);
        if (typeof d === "bigint") {
            if (d === 0n)
                luaL_argerror(L, 2, "zero");
            else
                lua_pushinteger(L, a % d);
        } else if (d === 0) {
            luaL_argerror(L, 2, "zero");
        } else
            lua_pushinteger(L, (a % d)|0);
    } else {
        let a = luaL_checknumber(L, 1);
        let b = luaL_checknumber(L, 2);
        lua_pushnumber(L, a%b);
    }
    return 1;
};

const math_modf = function(L) {
    if (lua_isinteger(L, 1)) {
        lua_settop(L, 1);  /* number is its own integer part */
        lua_pushnumber(L, 0);  /* no fractional part */
    } else {
        let n = luaL_checknumber(L, 1);
        let ip = n < 0 ? Math.ceil(n) : Math.floor(n);
        pushnumint(L, ip);
        lua_pushnumber(L, n === ip ? 0 : n - ip);
    }
    return 2;
};

const mathlib = {
    "abs":        math_abs,
    "acos":       math_acos,
    "asin":       math_asin,
    "atan":       math_atan,
    "ceil":       math_ceil,
    "cos":        math_cos,
    "deg":        math_deg,
    "exp":        math_exp,
    "floor":      math_floor,
    "fmod":       math_fmod,
    "log":        math_log,
    "max":        math_max,
    "min":        math_min,
    "modf":       math_modf,
    "rad":        math_rad,
    "random":     math_random,
    "randomseed": math_randomseed,
    "sin":        math_sin,
    "sqrt":       math_sqrt,
    "tan":        math_tan,
    "tointeger":  math_toint,
    "type":       math_type,
    "ult":        math_ult
};

const luaopen_math = function(L) {
    luaL_newlib(L, mathlib);
    lua_pushnumber(L, Math.PI);
    lua_setfield(L, -2, to_luastring("pi", true));
    lua_pushnumber(L, Infinity);
    lua_setfield(L, -2, to_luastring("huge", true));
    lua_pushinteger(L, LUA_MAXINTEGER);
    lua_setfield(L, -2, to_luastring("maxinteger", true));
    lua_pushinteger(L, LUA_MININTEGER);
    lua_setfield(L, -2, to_luastring("mininteger", true));
    return 1;
};

module.exports.luaopen_math = luaopen_math;
module.exports.math_random54 = math_random54;
module.exports.math_randomseed54 = math_randomseed54;
