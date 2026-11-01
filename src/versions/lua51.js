"use strict";

const {
    add_math_compat,
    copy_field,
    unset_field,
    unset_global,
    unset_loaded
} = require('./helpers.js');

const compat_code = `
local function findenv(f)
    if type(f) == "number" then
        local info = debug.getinfo(f + 1, "f")
        if not info then return nil end
        f = info.func
    end
    local i = 1
    while true do
        local name, value = debug.getupvalue(f, i)
        if not name then return nil end
        if name == "_ENV" then return value end
        i = i + 1
    end
end

function getfenv(f)
    if f == nil then f = 1 end
    return findenv(f) or _G
end

function loadstring(s, name)
    return load(s, name, "t")
end

function table.maxn(t)
    local max = 0
    for k in pairs(t) do
        if type(k) == "number" and k > max then max = k end
    end
    return max
end

function table.getn(t)
    return #t
end
`;

const openlibs = function(L) {
    const lua = require('../lua.js');
    const lauxlib = require('../lauxlib.js');
    const { to_luastring } = require('../fengaricore.js');

    /* 5.1 aliases that need the 5.3 implementations as a source. */
    copy_field(L, "table", "unpack", "_G", "unpack");
    copy_field(L, "string", "gmatch", "string", "gfind");
    add_math_compat(L);

    let status = lauxlib.luaL_dostring(L, to_luastring(compat_code));
    if (status !== lua.LUA_OK)
        throw new Error("Lua 5.1 compatibility profile: " + lua.lua_tojsstring(L, -1));

    /* Removed in 5.1. */
    unset_global(L, "utf8");
    unset_loaded(L, "utf8");
    unset_global(L, "bit32");
    unset_loaded(L, "bit32");
    unset_global(L, "rawlen");
    unset_field(L, "string", "pack");
    unset_field(L, "string", "unpack");
    unset_field(L, "string", "packsize");
    unset_field(L, "string", "gmatch");
    unset_field(L, "table", "pack");
    unset_field(L, "table", "unpack");
    unset_field(L, "table", "move");
    unset_field(L, "math", "maxinteger");
    unset_field(L, "math", "mininteger");
    unset_field(L, "math", "type");
    unset_field(L, "math", "tointeger");
    unset_field(L, "math", "ult");
    unset_field(L, "coroutine", "isyieldable");
    unset_field(L, "package", "searchers");
};

module.exports = {
    name: "5.1",
    version: {
        major: 5,
        minor: 1,
        release: 5,
        num: 501,
        string: "Lua 5.1"
    },
    features: {
        integers: false,
        bitwise: false,
        goto: false,
        env: false,
        utf8: false,
        bit32: false,
        loaders: true
    },
    openlibs
};
