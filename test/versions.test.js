"use strict";

const path = require('path');
const {spawnSync} = require('child_process');

const lua = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib = require('../src/lualib.js');
const versions = require('../src/versions.js');
const luaconf = require('../src/luaconf.js');
const {to_luastring} = require("../src/fengaricore.js");

const ROOT = path.resolve(__dirname, '..');

const open = function(version) {
    let L = lauxlib.luaL_newstate(version);
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    return L;
};

const run = function(L, code) {
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
};

test('bundled versions are registered', () => {
    expect(versions.list()).toEqual(expect.arrayContaining(["5.1", "5.2", "5.3"]));
    expect(versions.getDefault()).toBe("5.3");
    expect(versions.get("lua51").name).toBe("5.1");
    expect(() => versions.get("9.9")).toThrow(/unknown Lua version/);
});

test('5.3 keeps the current surface', () => {
    let L = open("5.3");
    expect(lua.lua_version(L)).toBe(503);
    expect(versions.features(L).integers).toBe(true);
    run(L, `
        assert(type(table.pack) == "function")
        assert(type(table.unpack) == "function")
        assert(type(utf8) == "table")
        assert(type(string.pack) == "function")
        assert(type(bit32) == "nil")
        assert(package.searchers ~= nil and package.loaders == nil)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('5.2 profile exposes bit32 and hides 5.3 APIs', () => {
    let L = open("5.2");
    expect(lua.lua_version(L)).toBe(502);
    expect(versions.features(L).bit32).toBe(true);
    run(L, `
        assert(_VERSION == "Lua 5.2")
        assert(type(bit32) == "table")
        assert(bit32.band(0xff, 0x0f) == 15)
        assert(bit32.bor(1, 2) == 3)
        assert(bit32.bxor(0xff, 0x0f) == 0xf0)
        assert(bit32.bnot(0) == 4294967295)
        assert(bit32.lshift(1, 31) == 2147483648)
        assert(bit32.rshift(2147483648, 31) == 1)
        assert(bit32.arshift(2147483648, 31) == 4294967295)
        assert(bit32.extract(0xf0, 4, 4) == 0xf)
        assert(bit32.replace(0, 0xf, 4, 4) == 0xf0)
        assert(bit32.lrotate(1, 1) == 2)
        assert(bit32.rrotate(1, 1) == 2147483648)

        assert(type(string.pack) == "nil")
        assert(type(utf8) == "nil")
        assert(type(table.pack) == "function")
        assert(type(table.unpack) == "function")
        assert(type(table.maxn) == "function" and table.maxn({[9] = true}) == 9)
        assert(type(unpack) == "function" and unpack({1, 2, 3}) == 1)
        assert(type(loadstring) == "function" and loadstring("return 5")() == 5)
        assert(type(module) == "function")
        assert(type(package.seeall) == "function")
        assert(type(package.cpath) == "string")
        assert(rawlen({1, 2}) == 2)
        assert(type(math.type) == "nil")
        assert(type(coroutine.isyieldable) == "nil")
        assert(package.searchers ~= nil and package.loaders == package.searchers)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('5.1 profile adds compatibility globals and uses package.loaders', () => {
    let L = open("5.1");
    expect(lua.lua_version(L)).toBe(501);
    expect(versions.features(L).loaders).toBe(true);
    run(L, `
        assert(_VERSION == "Lua 5.1")
        assert(type(unpack) == "function")
        assert(type(loadstring) == "function")
        assert(type(getfenv) == "function")
        assert(type(setfenv) == "function")
        assert(type(module) == "function")
        assert(type(package.seeall) == "function")
        assert(type(table.maxn) == "function")
        assert(type(table.getn) == "function")
        assert(type(string.gfind) == "function")
        assert(string.gfind == string.gfind)
        assert(type(math.log10) == "function")
        assert(math.log10(100) == 2)
        assert(package.loaders ~= nil and package.searchers == nil)

        assert(unpack({1, 2, 3}) == 1)
        assert(table.maxn({[3] = "x", [9] = "y"}) == 9)
        assert(table.getn({1, 2, 3}) == 3)
        assert(loadstring("return 7")() == 7)

        local f = function() return math.pi end
        assert(getfenv(f) == _G)

        -- setfenv changes the function's _ENV upvalue (5.1 exposes _ENV)
        local chunk = loadstring("return answer")
        local env = { answer = 42 }
        assert(setfenv(chunk, env) == chunk)
        assert(getfenv(chunk) == env)
        assert(chunk() == 42)
        assert(setfenv(f, _G) == f)

        -- module() names the caller's environment and fills package.loaded
        package.preload.vermod2 = function()
            module("vermod2", package.seeall)
            value = 10
            function getvalue() return value end
        end
        local mod = require("vermod2")
        assert(mod == package.loaded.vermod2)
        assert(_G.vermod2 == mod)
        assert(mod.value == 10 and mod.getvalue() == 10)
        assert(mod._M == mod and mod._NAME == "vermod2" and mod._PACKAGE == "")

        local seen = setmetatable({}, { __name = "keep" })
        package.seeall(seen)
        assert(getmetatable(seen).__name == "keep")
        assert(getmetatable(seen).__index == _G)

        package.preload.vermod = function() return {ok = true} end
        assert(require("vermod").ok == true)

        assert(type(bit32) == "nil")
        assert(type(utf8) == "nil")
        assert(type(string.pack) == "nil")
        assert(type(table.pack) == "nil")
        assert(type(table.unpack) == "nil")
        assert(type(rawlen) == "nil")
        assert(type(math.type) == "nil")
        assert(type(coroutine.isyieldable) == "nil")
        assert(type(string.gmatch) == "function")
        assert(type(string.gfind) == "function")
        assert(type(table.foreach) == "function")
        assert(type(table.foreachi) == "function")
        assert(type(math.mod) == "function" and math.mod(7, 3) == 1)
        assert(type(gcinfo) == "function" and gcinfo() >= 0)
        assert(type(debug.getfenv) == "function")
        assert(type(debug.setfenv) == "function")
        assert(type(debug.getuservalue) == "nil")
        assert(type(debug.upvalueid) == "nil")
        assert(type(package.cpath) == "string")
        assert(package.searchpath == nil)
        local sum = 0
        table.foreach({1, 2, 3}, function(_, v) sum = sum + v end)
        assert(sum == 6)
        local isum = 0
        table.foreachi({"a", "b"}, function(i) isum = isum + i end)
        assert(isum == 3)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('5.1/5.2 values never use the integer subtype', () => {
    for (const version of ["5.1", "5.2"]) {
        let L = open(version);
        run(L, `
            local t = {}
            for i = 1, 3 do t[i] = i end
            for k in pairs(t) do assert(type(k) == "number") end
            assert(tostring(1.0) == "1")
            assert(tostring(1.5) == "1.5")
            assert(1.0 .. "" == "1")
            local k = next({[7] = true})
            assert(tostring(k) == "7")
            local rk = next(debug.getregistry())
            return 1, 1 + 2, #"abc", tonumber("4"),
                   string.byte("A"), math.floor(3.7), math.abs(-2),
                   2^2, (function() return 5 end)(), k, rk
        `);
        for (let i = 1; i <= lua.lua_gettop(L); i++) {
            expect(lua.lua_type(L, i)).toBe(lua.LUA_TNUMBER);
            expect(lua.lua_isinteger(L, i)).toBe(false);
        }
        expect(lua.lua_tojsstring(L, -2)).toBe("7");
        expect(lua.lua_tojsstring(L, -1)).toBe("1");
        lua.lua_close(L);
    }
});

test('5.3 keeps integer values and their formatting', () => {
    let L = open("5.3");
    run(L, `
        local k = next({[7] = true})
        local rk = next(debug.getregistry())
        return tostring(1.0), k, rk
    `);
    expect(lua.lua_tojsstring(L, -3)).toBe("1.0");
    expect(lua.lua_isinteger(L, -2)).toBe(true);
    expect(lua.lua_isinteger(L, -1)).toBe(true);
    lua.lua_close(L);
});

test('number formatting matches PUC across profiles', () => {
    for (const [version, zero] of [["5.1", "-0"], ["5.2", "-0"],
        ["5.3", "-0.0"]]) {
        let L = open(version);
        run(L, `
            return tostring(1/0), tostring(-1/0), tostring(1e20),
                   tostring(1e-7), tostring(-0.0)
        `);
        expect(lua.lua_tojsstring(L, -5)).toBe("inf");
        expect(lua.lua_tojsstring(L, -4)).toBe("-inf");
        expect(lua.lua_tojsstring(L, -3)).toBe("1e+20");
        expect(lua.lua_tojsstring(L, -2)).toBe("1e-07");
        expect(lua.lua_tojsstring(L, -1)).toBe(zero);
        lua.lua_close(L);
    }
});

test('lua_number2str matches %.14g rounding', () => {
    expect(luaconf.lua_number2str(2 ** -1074)).toBe("4.9406564584125e-324");
    expect(luaconf.lua_number2str(2 ** -1022)).toBe("2.2250738585072e-308");
    expect(luaconf.lua_number2str(1.25)).toBe("1.25");
    expect(luaconf.lua_number2str(1000)).toBe("1000");
    expect(luaconf.lua_number2str(2 / 7)).toBe("0.28571428571429");
    expect(luaconf.lua_number2str(12000000000000.5))
        .toBe("12000000000000");
    expect(luaconf.lua_number2str(999999999999999)).toBe("1e+15");
    expect(luaconf.lua_number2str(123456789012345))
        .toBe("1.2345678901234e+14");
    expect(luaconf.lua_number2str(123456789012355))
        .toBe("1.2345678901236e+14");
    expect(luaconf.lua_number2str(-123456789012345))
        .toBe("-1.2345678901234e+14");
    expect(luaconf.lua_number2str(Infinity)).toBe("inf");
    expect(luaconf.lua_number2str(-Infinity)).toBe("-inf");
    expect(luaconf.lua_number2str(NaN)).toBe("-nan");
    expect(luaconf.lua_number2str(-0)).toBe("-0");
});

test('5.1/5.2 string.format follows PUC quoting', () => {
    let L51 = open("5.1");
    run(L51, `
        assert(string.format("%q", 7) == '"7"')
        assert(string.format("%q", 1.5) == '"1.5"')
        local ok, err = pcall(string.format, "%a", 1.0)
        assert(not ok and tostring(err):match("invalid option"), tostring(err))
        return true
    `);
    expect(lua.lua_toboolean(L51, -1)).toBe(true);
    lua.lua_close(L51);

    let L52 = open("5.2");
    run(L52, `
        assert(string.format("%q", 7) == '"7"')
        assert(string.format("%q", 1.5) == '"1.5"')
        assert(string.format("%a", 1.0) == "0x1p+0")
        return true
    `);
    expect(lua.lua_toboolean(L52, -1)).toBe(true);
    lua.lua_close(L52);
});

test('5.2 keeps the deprecated module/loadstring/unpack aliases', () => {
    let L = open("5.2");
    run(L, `
        assert(type(unpack) == "function" and unpack({1, 2}) == 1)
        assert(type(loadstring) == "function" and
               loadstring("return 11")() == 11)
        assert(type(table.maxn) == "function" and
               table.maxn({[4] = true}) == 4)
        assert(package.loaders == package.searchers)
        module("vermod52", package.seeall)
        local mod = package.loaded.vermod52
        assert(mod._NAME == "vermod52" and mod._M == mod)
        assert(getmetatable(mod).__index == _G)
        local function current() return _NAME end
        assert(current() == "vermod52")
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});

test('5.2 profile rejects 5.3 operators and keeps goto', () => {
    let L = open("5.2");
    run(L, `
        local f, e = load("return 1 // 2")
        assert(not f and e:match("near '//'"), e)
        local g, ge = load("return 1 & 2")
        assert(not g and ge:match("near '&'"), ge)
        local h, he = load("return ~1")
        assert(not h and he:match("near '~'"), he)
        local i, ie = load("return 1 << 2")
        assert(not i and ie:match("near '<<'"), ie)

        goto done
        ::done::
        assert(2147483647 + 1 == 2147483648)
        assert(tonumber("2147483647") + 1 == 2147483648)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});

test('5.1 profile treats goto as a name and rejects labels', () => {
    let L = open("5.1");
    run(L, `
        goto = 1
        assert(goto == 1)
        local f, e = loadstring("goto done ::done:: return true")
        assert(not f and e:match("syntax error"), e)
        local g, ge = loadstring("return 1 // 2")
        assert(not g and ge:match("near '//'"), ge)
        local h, he = loadstring("return 1 | 2")
        assert(not h and he:match("near '|'"), he)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);
});

test('loadbufferx hook is used by the version implementation', () => {
    let called = null;
    versions.register({
        name: "test-loader",
        version: {major: 9, minor: 8, release: 0, num: 998, string: "Lua 9.8"},
        features: {integers: false},
        loadbufferx: function(L, buff, size, name, mode) {
            called = {size: size, name: lua.lua_tojsstring(L, -1)};
            let impl = L.l_G.impl;
            let saved = impl.loadbufferx;
            impl.loadbufferx = null;
            try {
                return lauxlib.luaL_loadbuffer(L, buff, size, name);
            } finally {
                impl.loadbufferx = saved;
            }
        }
    });

    let L = lauxlib.luaL_newstate("test-loader");
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring("return 7"))).toBe(lua.LUA_OK);
    expect(called).not.toBe(null);
    expect(called.size).toBe(8);
    lua.lua_call(L, 0, 1);
    expect(lua.lua_tointeger(L, -1)).toBe(7);
    lua.lua_close(L);
});

test('5.1-only APIs: newproxy and table.setn', () => {
    let L = open("5.1");
    run(L, `
        local p = newproxy()
        assert(type(p) == "userdata" and getmetatable(p) == nil)
        local q = newproxy(true)
        assert(type(getmetatable(q)) == "table")
        local r = newproxy(q)
        assert(getmetatable(r) == getmetatable(q))
        local ok, err = pcall(newproxy, {})
        assert(not ok and err:match("boolean or proxy expected"), err)

        local t = {}
        assert(table.setn(t, 20) == t)
        assert(type(table.setn) == "function")

        local parts = {"return 7"}
        local chunk = load(function() return table.remove(parts, 1) end)
        assert(chunk() == 7)
        local ok, berr = pcall(load, "return 1")
        assert(not ok and tostring(berr):match("function expected"), berr)
        assert(loadstring("return 8")() == 8)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
    lua.lua_close(L);

    let L52 = open("5.2");
    run(L52, `
        assert(type(newproxy) == "nil")
        assert(type(table.setn) == "nil")
        assert(type(loadstring) == "function")
        assert(loadstring("return 9")() == 9)
        assert(load("return 9")() == 9)
        return true
    `);
    expect(lua.lua_toboolean(L52, -1)).toBe(true);
    lua.lua_close(L52);
});

test('os.exit accepts a boolean only from 5.2', () => {
    let L51 = open("5.1");
    run(L51, `
        local ok, err = pcall(os.exit, true)
        assert(not ok and err:match("number expected"), err)
        return true
    `);
    expect(lua.lua_toboolean(L51, -1)).toBe(true);
    lua.lua_close(L51);

    const run_exit = function(arg) {
        const code = `
            const { api } = require("./src/fengari.js");
            const state = api.createState({ version: "5.2" });
            state.run("os.exit(${arg})");
        `;
        return spawnSync(process.execPath, ["-e", code], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 30000
        });
    };
    expect(run_exit("true").status).toBe(0);
    expect(run_exit("false").status).toBe(1);
});

test('default version can be switched and custom implementations registered', () => {
    let called = false;
    versions.register({
        name: "test-custom",
        version: {major: 9, minor: 9, release: 0, num: 999, string: "Lua 9.9"},
        features: {integers: false},
        openlibs: function() { called = true; }
    });

    let L = lauxlib.luaL_newstate("test-custom");
    lualib.luaL_openlibs(L);
    expect(called).toBe(true);
    expect(lua.lua_version(L)).toBe(999);
    lua.lua_close(L);

    try {
        versions.setDefault("5.1");
        let L2 = lauxlib.luaL_newstate();
        expect(lua.lua_version(L2)).toBe(501);
        lua.lua_close(L2);
    } finally {
        versions.setDefault("5.3");
    }
});
