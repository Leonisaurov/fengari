"use strict";

/*
** Compile-time benchmark: load a chunk with many constant-folded
** expressions. Measures parser + code generator + constant folding.
**
** Usage: node bench/compile.js [--repeat=N] [--funcs=N] [--locals=N]
*/

const lauxlib = require("../src/lauxlib.js");
const lualib  = require("../src/lualib.js");
const lua     = require("../src/lua.js");
const { to_luastring } = require("../src/fengaricore.js");

let repeat = 9;
let funcs = 10;
let locals = 150;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--repeat=(\d+)$/.exec(arg)))
        repeat = parseInt(m[1], 10);
    else if ((m = /^--funcs=(\d+)$/.exec(arg)))
        funcs = parseInt(m[1], 10);
    else if ((m = /^--locals=(\d+)$/.exec(arg)))
        locals = parseInt(m[1], 10);
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const lines = [];
for (let f = 0; f < funcs; f++) {
    lines.push(`local function f${f}()`);
    for (let i = 0; i < locals; i++)
        lines.push(`local x${i} = (${i} + 2) * 3 - 1 / 2 + (${i} << 1)`);
    lines.push("return x0", "end");
}
lines.push("return f0");
const chunk = to_luastring(lines.join("\n"));

const L = lauxlib.luaL_newstate();
if (!L) throw new Error("failed to create lua state");
lualib.luaL_openlibs(L);

const compile = function() {
    lua.lua_settop(L, 0);
    if (lauxlib.luaL_loadstring(L, chunk) !== lua.LUA_OK)
        throw new Error("compile failed: " + lua.lua_tojsstring(L, -1));
};

compile();  /* warm up */
const samples = [];
for (let i = 0; i < repeat; i++) {
    const start = process.hrtime.bigint();
    compile();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
}
lua.lua_close(L);

const min = Math.min(...samples);
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
console.log(`compile-constfold (${funcs} functions x ${locals} locals): ` +
    `min ${min.toFixed(1)} ms, mean ${mean.toFixed(1)} ms`);
