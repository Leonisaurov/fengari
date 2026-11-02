#!/usr/bin/env node

/*
** Compares each benchmark against PUC Lua.
**
** Usage:
**   node bench/compare.js [--repeat=N]
**
** Finds Lua via $LUA_BIN, then lua5.3, lua5.4 and lua.
*/

"use strict";

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BENCH_DIR = __dirname;

let repeat = 3;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--repeat=(\d+)$/.exec(arg)))
        repeat = parseInt(m[1], 10);
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const which = function(bin) {
    try {
        execFileSync(bin, ["-v"], { stdio: "ignore" });
        return true;
    } catch (e) {
        return false;
    }
};

let lua_bin = process.env.LUA_BIN || null;
if (lua_bin !== null && !which(lua_bin)) {
    console.error(`LUA_BIN=${lua_bin} is not a working Lua interpreter`);
    process.exit(2);
}
if (lua_bin === null) {
    for (const candidate of ["lua5.3", "lua5.4", "lua"]) {
        if (which(candidate)) {
            lua_bin = candidate;
            break;
        }
    }
}
if (lua_bin === null) {
    console.error("PUC Lua not found. Install lua5.3 (or set LUA_BIN) to compare.");
    process.exit(2);
}

const version = execFileSync(lua_bin, ["-v"], { encoding: "utf8" }).trim();
const files = fs.readdirSync(BENCH_DIR)
    .filter((name) => name.endsWith(".lua"))
    .filter((name) => !name.startsWith("compare-"))
    .sort();

const puc_time = function(file) {
    const out = execFileSync(lua_bin, [
        path.join(BENCH_DIR, "compare-puc.lua"),
        path.join(BENCH_DIR, file),
        String(repeat)
    ], { encoding: "utf8" });
    return parseFloat(out.trim()) * 1000;  /* seconds -> ms */
};

const fengari_time = function(file) {
    const name = file.replace(/\.lua$/, "");
    const out = execFileSync(process.execPath, [
        path.join(BENCH_DIR, "run.js"),
        `--repeat=${repeat}`,
        "--json",
        `--filter=^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.lua$`
    ], { encoding: "utf8" });
    const result = JSON.parse(out);
    return result.benchmarks[0].min;
};

console.log(`PUC Lua: ${version}`);
console.log("");
console.log("benchmark          fengari ms     PUC ms    ratio");
console.log("-----------------  -----------  ---------  -------");

let total_fengari = 0;
let total_puc = 0;
for (const file of files) {
    const name = file.replace(/\.lua$/, "");
    const fengari = fengari_time(file);
    const puc = puc_time(file);
    total_fengari += fengari;
    total_puc += puc;
    console.log(
        name.padEnd(17) +
        fengari.toFixed(1).padStart(11) +
        puc.toFixed(1).padStart(11) +
        (fengari / puc).toFixed(1).padStart(8) + "x"
    );
}
console.log(
    "TOTAL".padEnd(17) +
    total_fengari.toFixed(1).padStart(11) +
    total_puc.toFixed(1).padStart(11) +
    (total_fengari / total_puc).toFixed(1).padStart(8) + "x"
);
