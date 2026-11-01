"use strict";

/*
** Shared helpers for the version profiles. Core modules are required lazily
** so that loading a profile from versions.js during state creation does not
** introduce a module cycle.
*/

const to_luastring = function(s) {
    return require('../fengaricore.js').to_luastring(s);
};

const unset_global = function(L, name) {
    const lua = require('../lua.js');
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, to_luastring(name));
};

const unset_field = function(L, libname, field) {
    const lua = require('../lua.js');
    lua.lua_getglobal(L, to_luastring(libname));
    if (lua.lua_istable(L, -1)) {
        lua.lua_pushnil(L);
        lua.lua_setfield(L, -2, to_luastring(field));
    }
    lua.lua_pop(L, 1);
};

const unset_loaded = function(L, name) {
    const lua = require('../lua.js');
    lua.lua_getglobal(L, to_luastring("package"));
    if (lua.lua_istable(L, -1)) {
        lua.lua_getfield(L, -1, to_luastring("loaded"));
        if (lua.lua_istable(L, -1)) {
            lua.lua_pushnil(L);
            lua.lua_setfield(L, -2, to_luastring(name));
        }
        lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 1);
};

const copy_field = function(L, fromlib, fromfield, tolib, tofield) {
    const lua = require('../lua.js');
    lua.lua_getglobal(L, to_luastring(fromlib));
    if (lua.lua_istable(L, -1)) {
        lua.lua_getfield(L, -1, to_luastring(fromfield));
        lua.lua_getglobal(L, to_luastring(tolib));
        if (lua.lua_istable(L, -1)) {
            lua.lua_pushvalue(L, -2);
            lua.lua_setfield(L, -2, to_luastring(tofield));
        }
        lua.lua_pop(L, 1);
        lua.lua_pop(L, 1);
    } else {
        lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 1);
};

const set_math = function(L, name, fn) {
    const lua = require('../lua.js');
    lua.lua_getglobal(L, to_luastring("math"));
    if (lua.lua_istable(L, -1)) {
        lua.lua_pushcfunction(L, fn);
        lua.lua_setfield(L, -2, to_luastring(name));
    }
    lua.lua_pop(L, 1);
};

/* Functions present in Lua 5.1/5.2 but removed from 5.3. */
const add_math_compat = function(L) {
    const lua = require('../lua.js');
    const lauxlib = require('../lauxlib.js');
    const luaconf = require('../luaconf.js');
    const num = function(L1, i) {
        return lauxlib.luaL_checknumber(L1, i);
    };

    set_math(L, "atan2", function(L1) {
        lua.lua_pushnumber(L1, Math.atan2(num(L1, 1), num(L1, 2)));
        return 1;
    });
    set_math(L, "cosh", function(L1) {
        lua.lua_pushnumber(L1, Math.cosh(num(L1, 1)));
        return 1;
    });
    set_math(L, "sinh", function(L1) {
        lua.lua_pushnumber(L1, Math.sinh(num(L1, 1)));
        return 1;
    });
    set_math(L, "tanh", function(L1) {
        lua.lua_pushnumber(L1, Math.tanh(num(L1, 1)));
        return 1;
    });
    set_math(L, "log10", function(L1) {
        lua.lua_pushnumber(L1, Math.log10(num(L1, 1)));
        return 1;
    });
    set_math(L, "pow", function(L1) {
        lua.lua_pushnumber(L1, Math.pow(num(L1, 1), num(L1, 2)));
        return 1;
    });
    set_math(L, "frexp", function(L1) {
        const fe = luaconf.frexp(num(L1, 1));
        lua.lua_pushnumber(L1, fe[0]);
        lua.lua_pushinteger(L1, fe[1]);
        return 2;
    });
    set_math(L, "ldexp", function(L1) {
        lua.lua_pushnumber(L1, luaconf.ldexp(num(L1, 1), num(L1, 2)));
        return 1;
    });
};

module.exports = {
    add_math_compat,
    copy_field,
    set_math,
    to_luastring,
    unset_field,
    unset_global,
    unset_loaded
};
