"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");

test("the ES module entry exposes the same names", () => {
    const entry = pathToFileURL(path.join(__dirname, "..", "src", "fengari.mjs")).href;
    const code = `
        import fengari, { lua, lauxlib, lualib, versions, vfs, api, to_luastring, to_jsstring } from ${JSON.stringify(entry)};
        if (lua.LUA_OK !== 0) throw new Error("bad LUA_OK");
        if (to_jsstring(to_luastring("esm")) !== "esm") throw new Error("bad strings");
        if (typeof versions.register !== "function") throw new Error("bad versions");
        if (typeof vfs.mount !== "function") throw new Error("bad vfs");
        if (fengari.lua !== lua) throw new Error("bad default export");
        if (typeof lualib.luaL_openlibs !== "function") throw new Error("bad lualib");
        const state = api.createState();
        try {
            if (state.run("return 6 * 7") !== 42) throw new Error("bad run");
        } finally {
            state.close();
        }
        console.log("esm ok");
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        encoding: "utf8",
        timeout: 30000
    });
    expect(out).toContain("esm ok");
});
