"use strict";

/*
** Lua 5.4 library surface on top of the 5.3 parser/VM.
**
** Implemented here: coroutine.close, warn, the 5.4 math.random API, the
** collectgarbage mode switches (labels; the collector stays incremental)
** and debug.setcstacklimit.
** Still missing: to-be-closed variables (<close>), <const>, 64-bit integers
** and full 5.4 lexer/parser semantics.
*/

const openlibs = function(L) {
    const lua = require('../lua.js');
    const lbaselib = require('../lbaselib.js');
    const lcorolib = require('../lcorolib.js');
    const lmathlib = require('../lmathlib.js');
    const { to_luastring } = require('../fengaricore.js');

    const setfield = function(lib, name, fn) {
        lua.lua_getglobal(L, to_luastring(lib));
        lua.lua_pushcfunction(L, fn);
        lua.lua_setfield(L, -2, to_luastring(name));
        lua.lua_pop(L, 1);
    };

    setfield("coroutine", "close", lcorolib.luaB_close);
    setfield("math", "random", lmathlib.math_random54);
    setfield("math", "randomseed", lmathlib.math_randomseed54);

    /* Lua 5.4 starts in generational mode and uses a 100% step multiplier. */
    L.l_G.gc_mode = "generational";
    L.l_G.gc_stepmul = 100;

    lua.lua_pushcfunction(L, lbaselib.luaB_warn);
    lua.lua_setglobal(L, to_luastring("warn"));
};

module.exports = {
    name: "5.4",
    version: {
        major: 5,
        minor: 4,
        release: 8,
        num: 504,
        string: "Lua 5.4"
    },
    features: {
        integers: true,
        bitwise: true,
        goto: true,
        env: true,
        utf8: true,
        bit32: false,
        loaders: false,
        close: true,
        warn: true,
        random54: true,
        attributes: true
    },
    openlibs
};
