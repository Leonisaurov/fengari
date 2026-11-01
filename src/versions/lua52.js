"use strict";

const {
    add_math_compat,
    unset_field,
    unset_global,
    unset_loaded
} = require('./helpers.js');

const openlibs = function(L) {
    const lua = require('../lua.js');
    const lauxlib = require('../lauxlib.js');
    const lbitlib = require('../lbitlib.js');
    const { to_luastring } = require('../fengaricore.js');

    /* Lua 5.2 still ships bit32. */
    lauxlib.luaL_requiref(L, to_luastring("bit32"), lbitlib.luaopen_bit32, 1);
    lua.lua_pop(L, 1);
    add_math_compat(L);

    /* APIs introduced in 5.3. */
    unset_global(L, "utf8");
    unset_loaded(L, "utf8");
    unset_field(L, "string", "pack");
    unset_field(L, "string", "unpack");
    unset_field(L, "string", "packsize");
    unset_field(L, "table", "move");
    unset_field(L, "math", "maxinteger");
    unset_field(L, "math", "mininteger");
    unset_field(L, "math", "type");
    unset_field(L, "math", "tointeger");
    unset_field(L, "math", "ult");
    unset_field(L, "coroutine", "isyieldable");
};

module.exports = {
    name: "5.2",
    version: {
        major: 5,
        minor: 2,
        release: 4,
        num: 502,
        string: "Lua 5.2"
    },
    features: {
        integers: false,
        bitwise: false,
        goto: true,
        env: true,
        utf8: false,
        bit32: true,
        loaders: false
    },
    openlibs
};
