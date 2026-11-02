"use strict";

const {
    add_math_compat,
    unset_field,
    unset_global,
    unset_loaded
} = require('./helpers.js');

const compat_code = `
local function findenv(f)
    local i = 1
    while true do
        local name, value = debug.getupvalue(f, i)
        if not name then return nil, nil end
        if name == "_ENV" then return value, i end
        i = i + 1
    end
end

function package.seeall(mod)
    local mt = getmetatable(mod)
    if type(mt) ~= "table" then
        mt = {}
        setmetatable(mod, mt)
    end
    mt.__index = _G
end

local function findtable(name)
    local t = _G
    for part in string.gmatch(name, "[^.]+") do
        local v = t[part]
        if v == nil then
            v = {}
            t[part] = v
        elseif type(v) ~= "table" then
            return nil
        end
        t = v
    end
    return t
end

function module(name, ...)
    if type(name) ~= "string" then
        error("bad argument #1 to 'module' (string expected)", 2)
    end
    local mod = package.loaded[name]
    if type(mod) ~= "table" then
        mod = findtable(name)
        if not mod then
            error("name conflict for module '" .. name .. "'", 2)
        end
        package.loaded[name] = mod
    end
    if mod._NAME == nil then
        mod._M = mod
        mod._NAME = name
        mod._PACKAGE = string.match(name, "^(.*%.)") or ""
    end
    local info = debug.getinfo(2, "f")
    if not info then
        error("module not called from a Lua function", 2)
    end
    local _, idx = findenv(info.func)
    if not idx then
        error("module not called from a Lua function", 2)
    end
    debug.setupvalue(info.func, idx, mod)
    for i = 1, select("#", ...) do
        local opt = select(i, ...)
        if opt == "seeall" then
            package.seeall(mod)
        elseif type(opt) == "function" then
            opt(mod)
        else
            error("bad argument #" .. (i + 1) .. " to 'module'", 2)
        end
    end
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

unpack = table.unpack
package.loaders = package.searchers
package.cpath = package.cpath or "./?.so"
`;

const openlibs = function(L) {
    const lua = require('../lua.js');
    const lauxlib = require('../lauxlib.js');
    const lbitlib = require('../lbitlib.js');
    const { to_luastring } = require('../fengaricore.js');

    /* Lua 5.2 still ships bit32. */
    lauxlib.luaL_requiref(L, to_luastring("bit32"), lbitlib.luaopen_bit32, 1);
    lua.lua_pop(L, 1);
    add_math_compat(L);

    let status = lauxlib.luaL_dostring(L, to_luastring(compat_code));
    if (status !== lua.LUA_OK)
        throw new Error("Lua 5.2 compatibility profile: " + lua.lua_tojsstring(L, -1));

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
