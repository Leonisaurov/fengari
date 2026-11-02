"use strict";

const fs      = require('fs');
const os      = require('os');
const path    = require('path');

const lua     = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib  = require('../src/lualib.js');
const {to_luastring} = require("../src/fengaricore.js");

test('os.time', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.time()
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_isinteger(L, -1)).toBe(true);
});


test('os.time (with format)', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.time({
            day = 8,
            month = 2,
            year = 2015
        })
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tointeger(L, -1))
        .toBe(new Date(2015, 1, 8, 12, 0, 0, 0).getTime() / 1000);
});


test('os.difftime', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local t1 = os.time()
        local t2 = os.time()
        return os.difftime(t2, t1)
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_isnumber(L, -1)).toBe(true);
});


test('os.date', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.date('%Y-%m-%d', os.time({
            day = 8,
            month = 2,
            year = 2015
        }))
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("2015-02-08");
});


test('os.date normalisation', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.date('%Y-%m-%d', os.time({
            day = 0,
            month = 0,
            year = 2014
        }))
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("2013-11-30");
});


test('os.time normalisation of table', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local t = {
            day = 20,
            month = 2,
            year = 2018
        }
        os.time(t)
        assert(t.day == 20, "unmodified day")
        assert(t.month == 2, "unmodified month")
        assert(t.year == 2018, "unmodified year")
        assert(t.wday == 3, "correct wday")
        assert(t.yday == 51, "correct yday")
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('os.date UTC and %j', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local t = os.date("!*t", 0)
        return os.date("!%Y-%m-%dT%H:%M:%SZ", 0),
               os.date("!%j", 0),
               os.date("!%Z %z", 0),
               os.date("%j", os.time({ day = 20, month = 2, year = 2018 })),
               t.year, t.month, t.day, t.hour, t.wday, t.yday
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -10)).toBe("1970-01-01T00:00:00Z");
    expect(lua.lua_tojsstring(L, -9)).toBe("001");
    expect(lua.lua_tojsstring(L, -8)).toBe("UTC +0000");
    expect(lua.lua_tojsstring(L, -7)).toBe("051");
    expect(lua.lua_tointeger(L, -6)).toBe(1970);  /* year */
    expect(lua.lua_tointeger(L, -5)).toBe(1);     /* month */
    expect(lua.lua_tointeger(L, -4)).toBe(1);     /* day */
    expect(lua.lua_tointeger(L, -3)).toBe(0);     /* hour */
    expect(lua.lua_tointeger(L, -2)).toBe(5);     /* wday: Thursday */
    expect(lua.lua_tointeger(L, -1)).toBe(1);     /* yday */
});


test('os.setlocale', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        assert("C" == os.setlocale())
        assert("C" == os.setlocale(""))
        assert("C" == os.setlocale("C"))
        assert("C" == os.setlocale("POSIX"))
        assert(nil == os.setlocale("any_other_locale"))
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('os.getenv', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.getenv('PATH')
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_isstring(L, -1)).toBe(true);
});


test('os.remove, os.rename and os.tmpname', () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), "fengari-os-"));
    let from = path.join(dir, "from.txt");
    let to = path.join(dir, "to.txt");
    fs.writeFileSync(from, "content");

    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        assert(os.rename(${JSON.stringify(from)}, ${JSON.stringify(to)}))
        assert(io.open(${JSON.stringify(from)}) == nil)
        local f = assert(io.open(${JSON.stringify(to)}, "r"))
        assert(f:read("a") == "content")
        f:close()
        assert(os.remove(${JSON.stringify(to)}))

        local name = os.tmpname()
        assert(type(name) == "string" and #name > 0)
        local tmp = assert(io.open(name, "w"))
        tmp:write("temporary")
        tmp:close()
        assert(os.remove(name))

        local missing, message, errno = os.remove(${JSON.stringify(path.join(dir, "missing.txt"))})
        assert(missing == nil and type(message) == "string" and errno ~= 0)
    `;

    try {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, 0);
        expect(fs.existsSync(to)).toBe(false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});


(process.platform === "win32" ? test.skip : test)('os.execute runs a shell command', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        assert(os.execute())
        local ok, what, code = os.execute("true")
        assert(ok == true and what == "exit" and code == 0)
        local nok, nwhat, ncode = os.execute("exit 3")
        assert(nok == nil and nwhat == "exit" and ncode == 3)
    `;

    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});
