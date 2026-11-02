#!/usr/bin/env node

/*
** Parser/undump fuzzer. Feeds random and mutated chunks to luaL_loadbufferx.
** Chunks are loaded but never executed, so a crash here means the parser or
** the undumper threw instead of returning an error status.
**
** Usage: node scripts/fuzz.js [--iterations=N] [--seed=N] [--verbose]
*/

"use strict";

const lua     = require("../src/lua.js");
const lauxlib = require("../src/lauxlib.js");
const { to_luastring } = require("../src/fengaricore.js");

let iterations = 2000;
let seed = 0x9e3779b9;
let verbose = false;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--iterations=(\d+)$/.exec(arg)))
        iterations = parseInt(m[1], 10);
    else if ((m = /^--seed=(\d+)$/.exec(arg)))
        seed = parseInt(m[1], 10) >>> 0;
    else if (arg === "--verbose")
        verbose = true;
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const random = function() {
    /* xorshift32 */
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0x100000000;
};

const randint = function(n) {
    return Math.floor(random() * n);
};

const random_bytes = function(max) {
    const length = randint(max + 1);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++)
        out[i] = randint(256);
    return out;
};

const tokens = [
    "local", "function", "return", "end", "if", "then", "else", "for", "do",
    "while", "repeat", "until", "break", "goto", "::label::", "{", "}", "(",
    ")", "[", "]", "=", "==", "~=", "<", "<=", ">", ">=", "+", "-", "*", "/",
    "//", "%", "^", "#", "&", "|", "~", "<<", ">>", "..", "...", ",", ";", ":",
    ".", "nil", "true", "false", "0", "1", "-1", "3.5", "0x10", "1e10",
    "\"str\"", "'s'", "[[long]]", "_ENV", "x", "f"
];

const random_source = function() {
    const parts = [];
    const count = 1 + randint(40);
    for (let i = 0; i < count; i++)
        parts.push(tokens[randint(tokens.length)]);
    return to_luastring(parts.join(random() < 0.5 ? " " : ""));
};

const dump = function(source) {
    const L = lauxlib.luaL_newstate();
    if (!L)
        return null;
    try {
        if (lauxlib.luaL_loadstring(L, to_luastring(source)) !== lua.LUA_OK)
            return null;
        const chunks = [];
        const status = lua.lua_dump(L, function(L1, b, size, B) {
            B.push(...b.slice(0, size));
            return 0;
        }, chunks, false);
        return status === 0 ? Uint8Array.from(chunks) : null;
    } finally {
        lua.lua_close(L);
    }
};

const mutate = function(bytes) {
    const out = Uint8Array.from(bytes);
    const edits = 1 + randint(8);
    for (let i = 0; i < edits; i++) {
        const at = randint(out.length);
        out[at] = randint(256);
    }
    return out;
};

const seed_dump = dump("local x = 1 for i = 1, 3 do x = x + i end return x");
if (seed_dump === null)
    throw new Error("could not produce a seed bytecode chunk");

const cases = [];
for (let i = 0; i < iterations; i++) {
    switch (i % 4) {
        case 0:
            cases.push({ name: "random-bytes", data: random_bytes(256) });
            break;
        case 1:
            cases.push({ name: "random-source", data: random_source() });
            break;
        case 2: {
            const header = new Uint8Array([0x1b, 0x4c, 0x75, 0x61]);
            const body = random_bytes(128);
            const data = new Uint8Array(header.length + body.length);
            data.set(header);
            data.set(body, header.length);
            cases.push({ name: "malformed-bytecode", data: data });
            break;
        }
        default:
            cases.push({ name: "mutated-bytecode", data: mutate(seed_dump) });
            break;
    }
}

const counts = { ok: 0, error: 0 };
let failures = 0;
for (const item of cases) {
    const L = lauxlib.luaL_newstate();
    if (!L) {
        console.error("failed to create a state");
        process.exit(1);
    }
    try {
        const status = lauxlib.luaL_loadbufferx(L, item.data, item.data.length,
            to_luastring("fuzz"), null);
        if (status === lua.LUA_OK)
            counts.ok++;
        else
            counts.error++;
    } catch (e) {
        failures++;
        console.error(`FAIL ${item.name}: threw ${e && e.stack ? e.stack : e}`);
        console.error(`  input (${item.data.length} bytes): ` +
            Buffer.from(item.data).toString("hex"));
        if (failures >= 10)
            break;
    } finally {
        lua.lua_close(L);
    }
}

if (verbose)
    console.log(`loaded ok: ${counts.ok}, rejected: ${counts.error}`);
if (failures > 0) {
    console.error(`${failures} fuzz failures (seed ${seed})`);
    process.exit(1);
}
console.log(`fuzzed ${cases.length} chunks without crashes (seed ${seed >>> 0})`);
