#!/usr/bin/env node

/*
** Differential test: run test/differential/*.lua under Fengari and PUC Lua
** and compare stdout plus success/failure.
**
** Usage:
**   node scripts/diff-puc.js [--filter=regex] [--verbose]
**
** The interpreter is $LUA_BIN, then lua5.3, lua5.4 and lua. Error messages are
** not compared byte for byte (they legitimately differ), only whether the
** script succeeded.
*/

"use strict";

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "test", "differential");

let filter = null;
let verbose = false;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--filter=(.+)$/.exec(arg)))
        filter = new RegExp(m[1]);
    else if (arg === "--verbose")
        verbose = true;
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const works = function(bin) {
    return spawnSync(bin, ["-v"], { stdio: "ignore" }).status === 0;
};

let lua_bin = process.env.LUA_BIN || null;
if (lua_bin !== null && !works(lua_bin)) {
    console.error(`LUA_BIN=${lua_bin} is not a working Lua interpreter`);
    process.exit(2);
}
if (lua_bin === null) {
    for (const candidate of ["lua5.3", "lua5.4", "lua"]) {
        if (works(candidate)) {
            lua_bin = candidate;
            break;
        }
    }
}
if (lua_bin === null) {
    console.error("PUC Lua not found. Install lua5.3 (or set LUA_BIN).");
    process.exit(2);
}

const files = fs.readdirSync(CORPUS)
    .filter((name) => name.endsWith(".lua"))
    .filter((name) => name !== "lua54.lua")  /* needs the 5.4 profile; see lua54-puc.test.js */
    .filter((name) => filter === null || filter.test(name))
    .sort();

if (files.length === 0) {
    console.error("no differential tests matched");
    process.exit(2);
}

const run = function(command, args) {
    const r = spawnSync(command, args, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 30000
    });
    return {
        status: r.status,
        signal: r.signal,
        stdout: r.stdout || "",
        stderr: r.stderr || ""
    };
};

const crash = function(result) {
    return result.status === null || result.signal !== null;
};

let failures = 0;
for (const file of files) {
    const full = path.join(CORPUS, file);
    const expected = run(lua_bin, [full]);
    const actual = run(process.execPath, [path.join(ROOT, "scripts", "run-lua.js"), full]);

    const problems = [];
    if (crash(expected) || crash(actual))
        problems.push("interpreter crashed or timed out");
    if (expected.stdout !== actual.stdout)
        problems.push("stdout differs");
    if ((expected.status === 0) !== (actual.status === 0))
        problems.push(`status differs (PUC ${expected.status}, fengari ${actual.status})`);
    if (expected.status === 0 && expected.stderr !== "")
        problems.push("PUC wrote to stderr");
    if (actual.status === 0 && actual.stderr !== "")
        problems.push("fengari wrote to stderr");

    if (problems.length === 0) {
        console.log(`ok   ${file}`);
        if (verbose)
            console.log(actual.stdout.replace(/^/gm, "     "));
    } else {
        failures++;
        console.log(`FAIL ${file}: ${problems.join("; ")}`);
        if (expected.stdout !== actual.stdout) {
            console.log("  --- PUC stdout ---");
            console.log(expected.stdout.replace(/^/gm, "  "));
            console.log("  --- fengari stdout ---");
            console.log(actual.stdout.replace(/^/gm, "  "));
        }
        if (verbose) {
            if (expected.stderr) console.log("  PUC stderr:\n" + expected.stderr.replace(/^/gm, "  "));
            if (actual.stderr) console.log("  fengari stderr:\n" + actual.stderr.replace(/^/gm, "  "));
        }
    }
}

console.log("");
if (failures > 0) {
    console.log(`${failures}/${files.length} differential tests failed (${lua_bin})`);
    process.exit(1);
}
console.log(`${files.length} differential tests passed (${lua_bin})`);
