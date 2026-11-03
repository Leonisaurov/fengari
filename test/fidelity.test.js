"use strict";

const lua = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib = require('../src/lualib.js');
const {to_luastring} = require("../src/fengaricore.js");

const run = function(luaCode) {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    if (lauxlib.luaL_loadstring(L, to_luastring(luaCode)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
    return L;
};

test('float formatting matches C printf', () => {
    let L = run(`
        local cases = {
            {"%g", 1e-5, "1e-05"},
            {"%g", 1234567, "1.23457e+06"},
            {"%g", 1/3, "0.333333"},
            {"%g", 1e10, "1e+10"},
            {"%g", 0, "0"},
            {"%g", -0.0, "-0"},
            {"%g", math.huge, "inf"},
            {"%g", -math.huge, "-inf"},
            {"%.0g", 1.5, "2"},
            {"%.1g", 1.5, "2"},
            {"%.3g", 1/3, "0.333"},
            {"%.10g", 1/3, "0.3333333333"},
            {"%.0g", 100000, "1e+05"},
            {"%e", 0, "0.000000e+00"},
            {"%.2e", 1234, "1.23e+03"},
            {"%E", 0, "0.000000E+00"},
            {"%e", 0.0001, "1.000000e-04"},
            {"%f", 0, "0.000000"},
            {"%.2f", 1.5, "1.50"},
            {"%.2f", -0.0, "-0.00"},
            {"%.2f", 1e21, "1000000000000000000000.00"},
            {"%10.3g", -0.0, "        -0"},
            {"%-10.3g", -0.0, "-0        "},
            {"%010.3g", -0.0, "-000000000"},
            {"%+g", 1, "+1"},
            {"% g", 0, " 0"},
            {"%#g", 0, "0.00000"},
            {"%#.1g", 1, "1."},
            {"%#.0e", 1, "1.e+00"},
            {"%#.0f", 1, "1."},
            {"%G", 1e10, "1E+10"},
        }
        for _, c in ipairs(cases) do
            local got = string.format(c[1], c[2])
            if got ~= c[3] then
                return false, c[1] .. " got '" .. got .. "' expected '" .. c[3] .. "'"
            end
        end
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('%q produces loadable literals', () => {
    let L = run(`
        for _, x in ipairs{0.1, 1/3, 1e300, -1e300} do
            local s = string.format("%q", x)
            assert(tonumber(s) == x, s)
        end
        local z = tonumber(string.format("%q", -0.0))
        assert(z == 0 and 1/z == -math.huge)

        local s = "a\\nb\\0c\\\\\\"\\r\\t"
        assert(load("return " .. string.format("%q", s))() == s)
        assert(#string.format("%s", "a\\0b") == 3)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('locale controls the decimal separator', () => {
    let L = run(`
        local set = os.setlocale("de-DE")
        if set then
            assert(string.format("%.2f", 1.5) == "1,50")
            assert(string.format("%a", 1.5) == "0x1,8p+0")
            assert(string.format("%q", 1.5) == "0x1.8p+0")
            assert(os.setlocale(nil) == "de-DE")
        end
        assert(os.setlocale("C") == "C")
        assert(string.format("%.2f", 1.5) == "1.50")
        assert(os.setlocale("not_a_real_locale") == nil)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('tracebacks include messages and stack frames', () => {
    let L = run(`
        local function inner() error("boom") end
        local ok, tb = xpcall(inner, debug.traceback)
        assert(ok == false)
        assert(string.find(tb, "boom"))
        assert(string.find(tb, "stack traceback"))

        local tb2 = debug.traceback("msg", 2)
        assert(string.find(tb2, "msg"))

        local co = coroutine.create(function() coroutine.yield() end)
        coroutine.resume(co)
        local tb3 = debug.traceback(co, "co-msg")
        assert(string.find(tb3, "co-msg", 1, true))
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('string.pack, utf8 and load edge cases', () => {
    let L = run(`
        local s = string.pack("!4i1i4", 1, 2)
        assert(#s == 8)
        local a, b = string.unpack("!4i1i4", s)
        assert(a == 1 and b == 2)
        assert(#string.pack("s4", "hello") == 9)
        assert(not pcall(string.unpack, "i4", "xx"))

        assert(utf8.len("\\255") == nil)
        assert(utf8.len("héllo") == 5)
        local s2 = utf8.char(0x1F600)
        assert(utf8.codepoint(s2) == 0x1F600)

        local f, err = load("\\27Lua garbage", "x", "b")
        assert(f == nil and type(err) == "string")
        local f2, err2 = load("return 1", "x", "b")
        assert(f2 == nil and string.find(err2, "text chunk"))
        assert(load("return 42", "x", "t")() == 42)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('os.date handles far dates and time normalisation', () => {
    let L = run(`
        assert(os.date("!%Y-%m-%d", 0) == "1970-01-01")
        assert(os.date("!%Y", 2147483647) == "2038")
        local t = os.time({year = 2100, month = 1, day = 1, hour = 12})
        assert(type(t) == "number")
        local d = os.date("!*t", 0)
        assert(d.year == 1970 and d.month == 1 and d.day == 1 and d.yday == 1)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('32-bit integer edge cases', () => {
    let L = run(`
        return math.mininteger // -1 == math.mininteger,
               math.mininteger % -1 == 0,
               1 << 31 == math.mininteger,
               1 << 32 == 0,
               -1 >> 1 == 0x7fffffff,
               -1 >> 32 == 0,
               1 >> -1 == 2,
               tonumber("2147483648") == 2147483648.0,
               tonumber("0xFFFFFFFF") == -1,
               tonumber("-2147483649") == -2147483649.0,
               math.tointeger(2147483648.0) == nil,
               math.tointeger(-2147483649.0) == nil
    `);
    for (let i = 1; i <= 12; i++)
        expect(lua.lua_toboolean(L, i - 12 - 1)).toBe(true);
});

test('next and pairs tolerate clearing and updating existing fields', () => {
    let L = run(`
        local t = {a = 1, b = 2, c = 3}
        for k in pairs(t) do t[k] = nil end
        assert(next(t) == nil)

        local u = {a = 1, b = 2, c = 3}
        local sum = 0
        for k, v in pairs(u) do
            u[k] = v + 1
            sum = sum + u[k]
        end
        assert(sum == 9)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('table.sort detects invalid comparators', () => {
    let L = run(`
        local ok, err = pcall(table.sort, {1, 2, 3, 4, 5},
            function() return true end)
        assert(ok == false)
        assert(string.find(err, "invalid order function for sorting"))

        -- with three elements PUC also skips the partition check
        assert(pcall(table.sort, {1, 2, 3}, function() return true end))
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('string bytes, interning and long strings', () => {
    let L = run(`
        local a = string.rep("x", 100)
        local b = string.rep("x", 100)
        assert(a == b and a ~= string.rep("x", 101))
        local s = "a\\0b\\255"
        assert(#s == 4)
        assert(string.byte(s, 1, -1) == 97 and string.byte(s, 2) == 0 and
               string.byte(s, 3) == 98 and string.byte(s, 4) == 255)
        assert(s:sub(2, 2) == "\\0")
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});


test('metamethod dispatch and edge cases', () => {
    let L = run(`
        local mt = {
            __eq = function(a, b) return true end,
            __lt = function(a, b) return true end,
            __le = function(a, b) return false end,
            __concat = function(a, b) return "cat" end,
            __len = function() return 42 end,
            __call = function(self, x) return x * 2 end,
            __index = function(t, k) return "idx:" .. k end,
            __newindex = function(t, k, v) rawset(t, "raw:" .. k, v) end,
            __tostring = function() return "OBJ" end,
            __unm = function() return "unm" end,
        }
        local a = setmetatable({}, mt)
        local b = setmetatable({}, mt)
        assert(a == b and a < b and not (a <= b))
        assert(#a == 42 and a .. b == "cat" and a(21) == 42)
        assert(a.foo == "idx:foo")
        a.bar = 1
        assert(rawget(a, "raw:bar") == 1)
        assert(tostring(a) == "OBJ" and -a == "unm")

        -- __eq is not consulted for different types
        local eqcalled = false
        local x = setmetatable({}, { __eq = function() eqcalled = true; return true end })
        assert(x ~= 1 and not eqcalled)

        -- <= falls back to __lt when __le is absent
        local lmt = { __lt = function() return false end }
        local l1, l2 = setmetatable({}, lmt), setmetatable({}, lmt)
        assert(l1 <= l2)

        -- an invalid metamethod raises an error
        assert(not pcall(function() return setmetatable({}, { __index = 42 }).x end))
        assert(not pcall(function() return setmetatable({}, { __concat = 42 }) .. "x" end))
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});

test('error honours level and non-string objects', () => {
    let L = run(`
        local function f() error("boom", 2) end
        local function caller() f() end
        local ok, err = pcall(caller)
        assert(err ~= "boom")
        assert(string.find(err, "boom"))

        local ok0, err0 = pcall(function() error("plain", 0) end)
        assert(ok0 == false and err0 == "plain")

        local obj = {}
        local ok1, err1 = pcall(function() error(obj) end)
        assert(ok1 == false and err1 == obj)
        return true
    `);
    expect(lua.lua_toboolean(L, -1)).toBe(true);
});
