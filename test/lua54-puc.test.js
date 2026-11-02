"use strict";

const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "test", "differential", "lua54.lua");

const find_lua54 = function() {
    const candidates = process.env.LUA54_BIN
        ? [process.env.LUA54_BIN]
        : ["lua5.4", "lua"];
    for (const candidate of candidates) {
        const r = spawnSync(candidate, ["-e", "io.write(_VERSION)"], {
            encoding: "utf8"
        });
        if (r.status === 0 && r.stdout === "Lua 5.4")
            return candidate;
    }
    return null;
};

const lua_bin = find_lua54();

(lua_bin === null ? test.skip : test)("the 5.4 corpus matches PUC Lua 5.4", () => {
    const expected = execFileSync(lua_bin, [CORPUS], {
        encoding: "utf8",
        timeout: 30000
    });
    const actual = execFileSync(process.execPath, [
        path.join(ROOT, "scripts", "run-lua.js"),
        CORPUS
    ], {
        encoding: "utf8",
        env: Object.assign({}, process.env, { LUA_PROFILE: "5.4" }),
        timeout: 30000
    });

    expect(actual).toBe(expected);
    expect(actual).not.toContain("FAIL");
    expect(actual).toContain("close.tailcall\tok");
});
