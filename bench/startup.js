"use strict";

/*
** Startup benchmark: module load, state creation and library registration.
** Also reports the size of the generated browser bundles when present.
**
** Usage: node bench/startup.js [--repeat=N] [--json]
*/

const fs = require("fs");
const path = require("path");

let repeat = 7;
let json = false;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--repeat=(\d+)$/.exec(arg)))
        repeat = parseInt(m[1], 10);
    else if (arg === "--json")
        json = true;
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const time = function(fn) {
    const start = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - start) / 1e6;
};

const load_start = process.hrtime.bigint();
require("../src/fengari.js");
const module_load_ms = Number(process.hrtime.bigint() - load_start) / 1e6;

const lua = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib = require("../src/lualib.js");

const samples = [];
for (let i = 0; i < repeat; i++) {
    let state;
    const total = time(() => {
        state = lauxlib.luaL_newstate();
        if (!state) throw new Error("failed to create lua state");
        lualib.luaL_openlibs(state);
    });
    samples.push(total);
    lua.lua_close(state);
}

const min = Math.min(...samples);
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const bundles = {};
for (const name of ["fengari.js", "fengari.min.js"]) {
    const file = path.join(__dirname, "..", "dist", name);
    if (fs.existsSync(file))
        bundles[name] = fs.statSync(file).size;
}

const result = {
    module_load_ms,
    state_and_libs_ms: { min, mean },
    bundles
};
if (json)
    console.log(JSON.stringify(result, null, 2));
else {
    console.log(`module load:        ${module_load_ms.toFixed(1)} ms`);
    console.log(`state + openlibs:   min ${min.toFixed(1)} ms, mean ${mean.toFixed(1)} ms`);
    for (const [name, size] of Object.entries(bundles))
        console.log(`${name.padEnd(19)} ${(size / 1024).toFixed(1)} KiB`);
}
