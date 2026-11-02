"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const find_lua = function() {
    if (process.env.LUA_BIN)
        return process.env.LUA_BIN;
    for (const candidate of ["lua5.3", "lua5.4", "lua"]) {
        const r = spawnSync(candidate, ["-v"], { stdio: "ignore" });
        if (r.status === 0)
            return candidate;
    }
    return null;
};

const lua_bin = find_lua();

(lua_bin === null ? test.skip : test)("output matches PUC Lua on the differential corpus", () => {
    const out = execFileSync(process.execPath, [
        path.join(ROOT, "scripts", "diff-puc.js")
    ], {
        encoding: "utf8",
        env: Object.assign({}, process.env, { LUA_BIN: lua_bin }),
        timeout: 120000
    });
    expect(out).toContain("differential tests passed");
});

test("the differential corpus is not empty", () => {
    const files = fs.readdirSync(path.join(ROOT, "test", "differential"))
        .filter((name) => name.endsWith(".lua"));
    expect(files.length).toBeGreaterThanOrEqual(8);
});
