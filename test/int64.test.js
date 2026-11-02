"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");
const { to_luastring } = require("../src/fengaricore.js");

const ROOT = path.resolve(__dirname, "..");

const run_child = function(code) {
    return execFileSync(process.execPath, ["-e", code], {
        cwd: ROOT,
        encoding: "utf8",
        env: Object.assign({}, process.env, {
            FENGARICONF: JSON.stringify({ LUA_INT64: true })
        }),
        timeout: 30000
    }).trim();
};

const run_default = function(code) {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK)
        throw new SyntaxError(lua.lua_tojsstring(L, -1));
    lua.lua_call(L, 0, -1);
    let n = lua.lua_gettop(L);
    let result = [];
    for (let i = 1; i <= n; i++) {
        if (lua.lua_isinteger(L, i))
            result.push(lua.lua_tojsstring(L, i));
        else if (lua.lua_type(L, i) === lua.LUA_TNUMBER)
            result.push(lua.lua_tonumber(L, i));
        else if (lua.lua_type(L, i) === lua.LUA_TBOOLEAN)
            result.push(lua.lua_toboolean(L, i));
        else
            result.push(lua.lua_tojsstring(L, i));
    }
    lua.lua_close(L);
    return result;
};

const eval_child = function(luaCode) {
    return run_child(`
        const { api } = require("./src/fengari.js");
        const state = api.createState();
        const show = (v) => JSON.stringify(v, (_k, x) =>
            typeof x === "bigint" ? x.toString() + "n" : x);
        const code = ${JSON.stringify(luaCode)};
        process.stdout.write(show(state.run(code)));
        state.close();
    `);
};

test("the default mode remains 32-bit", () => {
    expect(run_default(`
        return math.maxinteger, math.mininteger,
               2147483647 + 1, tostring(1), math.type(1)
    `)).toEqual(["2147483647", "-2147483648", "-2147483648", "1", "integer"]);
    expect(run_default(`
        local d = string.dump(function() return 1 end)
        return string.byte(d, 1, 6)
    `)).toEqual(["27", "76", "117", "97", "83", "0"]);
});

test("LUA_INT64 parses and formats 64-bit integers", () => {
    expect(eval_child(`
        return 9223372036854775807, -9223372036854775807,
               2147483648, math.type(1), tostring(2147483648)
    `)).toBe('["9223372036854775807n","-9223372036854775807n",' +
        '"2147483648n","integer","2147483648"]');

    expect(eval_child(`
        return tonumber("9223372036854775807"),
               tonumber("9223372036854775808"),
               math.type(tonumber("9223372036854775807"))
    `)).toBe('["9223372036854775807n",9223372036854776000,"integer"]');
});

test("LUA_INT64 arithmetic wraps at 64 bits", () => {
    expect(eval_child(`
        local a = 9223372036854775806
        return a + 1, a + 2, a - 9223372036854775807,
               a * 2, 9223372036854775807 // 3,
               9223372036854775807 % 3,
               -9223372036854775807 - 2
    `)).toBe('["9223372036854775807n","-9223372036854775808n",' +
        '"-1n","-4n","3074457345618258602n","1n",' +
        '"9223372036854775807n"]');

    expect(eval_child(`
        return 1 & 3, 1 | 2, 5 ~ 1, 1 << 40, (1 << 40) >> 40,
               1 / 2, 1 == 1.0, 1 < 2, 2 <= 2
    `)).toBe('["1n","3n","4n","1099511627776n","1n",0.5,true,true,true]');
});

test("LUA_INT64 handles loops, tables and string.format", () => {
    expect(eval_child(`
        local sum = 0
        for i = 1, 10 do sum = sum + i end
        local t = {}
        for i = 1, 5 do t[i] = i * 2 end
        return sum, #t, t[5],
               string.format("%d %x", 9223372036854775807, 255)
    `)).toBe('["55n","5n","10n","9223372036854775807 ff"]');

    expect(eval_child(`
        local t = {}
        t[9223372036854775807] = "max"
        return t[9223372036854775807], t[9223372036854775806]
    `)).toBe('["max",null]');
});

test("LUA_INT64 marks its bytecode and round-trips it", () => {
    expect(eval_child(`
        local d = string.dump(function() return 9223372036854775807 end)
        local fn = assert(load(d))
        local a, b, c, e, f, g = string.byte(d, 1, 6)
        return a, b, c, e, f, g, fn()
    `)).toBe('["27n","76n","117n","97n","83n","1n",' +
        '"9223372036854775807n"]');
});
