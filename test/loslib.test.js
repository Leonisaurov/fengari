"use strict";

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { execFileSync } = require('child_process');

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


test('os.date isdst and ISO-8601 week fields', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return os.date("!%G-%V-%g", 0),
               os.date("!%G-%V-%g", 1293840000),
               os.date("!%G-%V-%g", 1451606400),
               os.date("!%G-%V-%g", 1546214400),
               os.date("!%G-%V-%g", 1609459200),
               os.date("!%G-%V-%g", 1720000000),
               os.date("!*t", 1451606400).isdst
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    const expected = ["1970-01-70", "2010-52-10", "2015-53-15",
        "2019-01-19", "2020-53-20", "2024-27-24"];
    for (let i = 0; i < expected.length; i++)
        expect(lua.lua_tojsstring(L, i - 7)).toBe(expected[i]);
    expect(lua.lua_toboolean(L, -1)).toBe(false);
});


test('os.date isdst follows local daylight saving time', () => {
    if (process.platform === "win32")
        return;

    const luaCode = `
        local out = {}
        for _, t in ipairs{1720000000, 1700000000, 1705276800, 1721001600} do
            out[#out + 1] = tostring(os.date("*t", t).isdst)
        end
        io.write(table.concat(out, ","))
    `;
    const script = `
        const lua = require("./src/lua.js");
        const lauxlib = require("./src/lauxlib.js");
        const lualib = require("./src/lualib.js");
        const { to_luastring } = require("./src/fengaricore.js");
        const L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(L);
        if (lauxlib.luaL_dostring(L, to_luastring(${JSON.stringify(luaCode)})) !== lua.LUA_OK) {
            console.error(lua.lua_tojsstring(L, -1));
            process.exit(1);
        }
    `;
    const run = function(tz) {
        return execFileSync(process.execPath, ["-e", script], {
            cwd: path.join(__dirname, ".."),
            env: Object.assign({}, process.env, { TZ: tz }),
            encoding: "utf8"
        }).trim();
    };

    expect(run("America/New_York")).toBe("true,false,false,true");
    expect(run("Australia/Sydney")).toBe("false,true,true,false");
    expect(run("Europe/Madrid")).toBe("true,false,false,true");
    expect(run("UTC")).toBe("false,false,false,false");
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
    expect(lua.lua_tojsstring(L, -8)).toBe("GMT +0000");
    expect(lua.lua_tojsstring(L, -7)).toBe("051");
    expect(lua.lua_tointeger(L, -6)).toBe(1970);  /* year */
    expect(lua.lua_tointeger(L, -5)).toBe(1);     /* month */
    expect(lua.lua_tointeger(L, -4)).toBe(1);     /* day */
    expect(lua.lua_tointeger(L, -3)).toBe(0);     /* hour */
    expect(lua.lua_tointeger(L, -2)).toBe(5);     /* wday: Thursday */
    expect(lua.lua_tointeger(L, -1)).toBe(1);     /* yday */
});


test('os.date conversion specifiers (UTC)', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local cases = {
            { "%a", "Thu" }, { "%A", "Thursday" },
            { "%b", "Jan" }, { "%B", "January" },
            { "%c", "Thu Jan  1 00:00:00 1970" }, { "%C", "19" },
            { "%d", "01" }, { "%D", "01/01/70" }, { "%e", " 1" },
            { "%F", "1970-01-01" }, { "%h", "Jan" },
            { "%H", "00" }, { "%I", "12" }, { "%j", "001" },
            { "%k", " 0" }, { "%l", "12" },
            { "%m", "01" }, { "%M", "00" }, { "%n", "\\n" },
            { "%p", "AM" }, { "%P", "am" },
            { "%r", "12:00:00 AM" }, { "%R", "00:00" },
            { "%S", "00" }, { "%t", "\\t" }, { "%T", "00:00:00" },
            { "%u", "4" }, { "%U", "00" }, { "%w", "4" }, { "%W", "00" },
            { "%x", "01/01/70" }, { "%X", "00:00:00" },
            { "%y", "70" }, { "%Y", "1970" }, { "%z", "+0000" },
            { "%Z", "GMT" }, { "%%", "%" }
        }
        for _, case in ipairs(cases) do
            local got = os.date("!" .. case[1], 0)
            assert(got == case[2], case[1] .. ": " .. string.format("%q", got))
        end

        local later = {
            { "%a", "Fri" }, { "%A", "Friday" },
            { "%b", "Feb" }, { "%B", "February" },
            { "%c", "Fri Feb 13 23:31:30 2009" }, { "%C", "20" },
            { "%d", "13" }, { "%D", "02/13/09" }, { "%e", "13" },
            { "%F", "2009-02-13" },
            { "%H", "23" }, { "%I", "11" }, { "%j", "044" },
            { "%k", "23" }, { "%l", "11" },
            { "%m", "02" }, { "%M", "31" }, { "%p", "PM" }, { "%P", "pm" },
            { "%r", "11:31:30 PM" }, { "%R", "23:31" },
            { "%S", "30" }, { "%T", "23:31:30" }, { "%u", "5" },
            { "%U", "06" }, { "%w", "5" }, { "%W", "06" },
            { "%x", "02/13/09" }, { "%X", "23:31:30" },
            { "%y", "09" }, { "%Y", "2009" }
        }
        for _, case in ipairs(later) do
            local got = os.date("!" .. case[1], 1234567890)
            assert(got == case[2], case[1] .. ": " .. string.format("%q", got))
        end

        assert(os.date("!%U %W", 259200) == "01 00")
        assert(os.date("!%j %u", 951782400) == "060 2")

        local ok, err = pcall(os.date, "!abc%Qdef", 0)
        assert(not ok and err:match("invalid conversion specifier '%%Qdef'"), err)
        local ok2, err2 = pcall(os.date, "!%", 0)
        assert(not ok2 and err2:match("invalid conversion specifier '%%'"), err2)
    `;

    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('os.time rejects bad date fields and os.remove reports errno', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local ok, err = pcall(os.time, { year = "not a number" })
        assert(not ok and err:match("field 'year' is not an integer"), err)

        local removed, rerr, rcode = os.remove("fengari-definitely-missing-file")
        assert(removed == nil and type(rerr) == "string" and type(rcode) == "number")

        local bad = string.char(255)
        assert(os.setlocale(bad) == nil)
        assert(os.setlocale("C") == "C")
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
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

        local name = os.setlocale("de-DE", "numeric")
        if name then
            assert(os.setlocale(nil, "numeric") == name)
        end
        assert(nil == os.setlocale("de-DE", "collate"))
        assert(nil == os.setlocale("de-DE", "ctype"))
        assert(nil == os.setlocale("de-DE", "monetary"))
        assert(nil == os.setlocale("de-DE", "time"))
        assert("C" == os.setlocale("C"))
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
        local sok, swhat, scode = os.execute("kill -9 $$")
        assert(sok == nil and swhat == "signal" and scode == 9)
    `;

    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});
