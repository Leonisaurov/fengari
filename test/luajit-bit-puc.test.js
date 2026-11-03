"use strict";

const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "test", "differential", "luajit-bit.lua");

const find_luajit = function() {
    const candidates = process.env.LUAJIT_BIN
        ? [process.env.LUAJIT_BIN]
        : ["luajit", "luajit-2.1"];
    for (const candidate of candidates) {
        const r = spawnSync(candidate, ["-v"], { stdio: "ignore" });
        if (r.status === 0)
            return candidate;
    }
    return null;
};

const lua_bin = find_luajit();

(lua_bin === null ? test.skip : test)("the LuaJIT bit corpus matches", () => {
    const expected = execFileSync(lua_bin, [CORPUS], {
        encoding: "utf8",
        timeout: 30000
    });
    const actual = execFileSync(process.execPath, [
        path.join(ROOT, "scripts", "run-lua.js"),
        CORPUS
    ], {
        encoding: "utf8",
        env: Object.assign({}, process.env, {
            FENGARICONF: JSON.stringify({ LUAJIT_BIT: true })
        }),
        timeout: 30000
    });

    expect(actual).toBe(expected);
});
