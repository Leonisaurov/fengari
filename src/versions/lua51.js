"use strict";

const {
    add_math_compat,
    copy_field,
    unset_field,
    unset_global,
    unset_loaded
} = require('./helpers.js');

const compat_code = `
local gmatch = string.gmatch

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

function setfenv(f, env)
    if type(env) ~= "table" then
        error("bad argument #2 to 'setfenv' (table expected)", 2)
    end
    if type(f) == "number" then
        if f == 0 then
            error("setfenv cannot change environment of given object", 2)
        end
        local info = debug.getinfo(f + 1, "f")
        if not info then error("invalid level", 2) end
        f = info.func
    end
    if type(f) ~= "function" then
        error("bad argument #1 to 'setfenv' (function expected)", 2)
    end
    local i = 1
    while true do
        local name = debug.getupvalue(f, i)
        if not name then break end
        if name == "_ENV" then
            debug.setupvalue(f, i, env)
            return f
        end
        i = i + 1
    end
    error("setfenv cannot change environment of given object", 2)
end

local function findtable(name)
    local t = _G
    for part in gmatch(name, "[^.]+") do
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

function package.seeall(mod)
    local mt = getmetatable(mod)
    if type(mt) ~= "table" then
        mt = {}
        setmetatable(mod, mt)
    end
    mt.__index = _G
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
    setfenv(2, mod)
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

function table.getn(t)
    return #t
end
`;

const openlibs = function(L) {
    const lua = require('../lua.js');
    const lauxlib = require('../lauxlib.js');
    const lbaselib = require('../lbaselib.js');
    const ltablib = require('../ltablib.js');
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

    /* Lua 5.1-only APIs. */
    lua.lua_pushcfunction(L, lbaselib.luaB_newproxy);
    lua.lua_setglobal(L, to_luastring("newproxy"));
    lua.lua_pushcfunction(L, lbaselib.luaB_loadstring);
    lua.lua_setglobal(L, to_luastring("loadstring"));
    lua.lua_getglobal(L, to_luastring("table"));
    lua.lua_pushcfunction(L, ltablib.luaB_setn);
    lua.lua_setfield(L, -2, to_luastring("setn"));
    lua.lua_pop(L, 1);
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
