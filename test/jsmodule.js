"use strict";

const lua = require('../src/lua.js');

const open = function(L) {
    lua.lua_pushliteral(L, "hello from a JS searcher");
    return 1;
};

module.exports = {
    luaopen_jsmodule: open,
    luaopen_jsmodule_sub: open,
    luaopen_test_jsmodule: open
};
