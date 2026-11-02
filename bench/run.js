"use strict";

/*
** Runs every bench/*.lua file on Fengari and reports wall-clock timings.
**
** Usage:
**   node bench/run.js [--filter=name] [--repeat=N] [--warmup=N] [--json]
*/

const fs   = require("fs");
const path = require("path");

const lua     = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const lualib  = require("../src/lualib.js");
const { to_luastring, to_jsstring } = require("../src/fengaricore.js");

const BENCH_DIR = __dirname;

const args = {
    filter: null,
    repeat: 3,
    warmup: 1,
    json: false
};
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--filter=(.+)$/.exec(arg)))
        args.filter = new RegExp(m[1]);
    else if ((m = /^--repeat=(\d+)$/.exec(arg)))
        args.repeat = parseInt(m[1], 10);
    else if ((m = /^--warmup=(\d+)$/.exec(arg)))
        args.warmup = parseInt(m[1], 10);
    else if (arg === "--json")
        args.json = true;
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const files = fs.readdirSync(BENCH_DIR)
    .filter((name) => name.endsWith(".lua"))
    .filter((name) => !name.startsWith("compare-"))
    .filter((name) => args.filter === null || args.filter.test(name))
    .sort();

if (files.length === 0) {
    console.error("no benchmarks matched");
    process.exit(2);
}

const run_once = function(file) {
    const L = lauxlib.luaL_newstate();
    if (!L)
        throw new Error("failed to create lua state");
    try {
        lualib.luaL_openlibs(L);
        let status = lauxlib.luaL_loadfile(L, to_luastring(path.join(BENCH_DIR, file)));
        if (status === lua.LUA_OK)
            status = lua.lua_pcall(L, 0, 0, 0);
        if (status !== lua.LUA_OK) {
            lauxlib.luaL_traceback(L, L, lua.lua_tostring(L, -1), 1);
            throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
        }
    } finally {
        lua.lua_close(L);
    }
};

const time_once = function(file) {
    const start = process.hrtime.bigint();
    run_once(file);
    return Number(process.hrtime.bigint() - start) / 1e6;
};

const results = [];
for (const file of files) {
    const name = file.replace(/\.lua$/, "");
    for (let i = 0; i < args.warmup; i++)
        run_once(file);

    const samples = [];
    for (let i = 0; i < args.repeat; i++)
        samples.push(time_once(file));

    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    results.push({ name, min, max, mean });
}

if (args.json) {
    console.log(JSON.stringify({
        engine: "fengari",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        benchmarks: results
    }, null, 2));
} else {
    console.log(`fengari on node ${process.version} (${process.platform}/${process.arch})`);
    console.log("");
    console.log("benchmark          min ms    mean ms   max ms");
    console.log("-----------------  --------  --------  --------");
    for (const r of results) {
        console.log(
            r.name.padEnd(17) +
            r.min.toFixed(1).padStart(8) +
            r.mean.toFixed(1).padStart(10) +
            r.max.toFixed(1).padStart(10)
        );
    }
}
