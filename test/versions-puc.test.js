"use strict";

/*
 * Differential test for the 5.1/5.2 profiles. PUC Lua 5.1 and 5.2 are not
 * required by CI, so each version's test is skipped when its interpreter is
 * not available (LUA51_BIN / LUA52_BIN or lua5.1 / lua5.2 on PATH).
 */

const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "test", "differential", "lua51-52.lua");

const find = function(version, envName, candidates) {
    const list = process.env[envName] ? [process.env[envName]] : candidates;
    for (const candidate of list) {
        const r = spawnSync(candidate, ["-e", "io.write(_VERSION)"], {
            encoding: "utf8"
        });
        if (r.status === 0 && r.stdout === "Lua " + version)
            return candidate;
    }
    return null;
};

const run_puc = function(bin) {
    return execFileSync(bin, [CORPUS], { encoding: "utf8", timeout: 30000 });
};

const run_fengari = function(profile) {
    return execFileSync(process.execPath, [
        path.join(ROOT, "scripts", "run-lua.js"),
        CORPUS
    ], {
        encoding: "utf8",
        env: Object.assign({}, process.env, { LUA_PROFILE: profile }),
        timeout: 30000
    });
};

const check = function(version, envName, candidates, expected) {
    const bin = find(version, envName, candidates);
    (bin === null ? test.skip : test)(
        "the " + version + " corpus matches PUC Lua " + version, () => {
            const actual = run_fengari(version);
            expect(actual).toBe(run_puc(bin));
            expect(actual).not.toContain("FAIL");
            for (const name of expected)
                expect(actual).toContain(name + "\tok");
        });
};

check("5.1", "LUA51_BIN", ["lua5.1", "lua51"], [
    "value.tie1", "key.num", "fmt.qint", "fmt.a51",
    "lib51.foreach.run", "lib51.foreachi.run", "lib51.gcinfo"
]);

check("5.2", "LUA52_BIN", ["lua5.2", "lua52"], [
    "value.tie1", "key.num", "fmt.qint", "fmt.a52",
    "lib52.maxn", "lib52.module", "lib52.loaders"
]);
