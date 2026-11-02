"use strict";

const fs = require("fs");
const path = require("path");
const {generate, OUTPUT} = require("../scripts/generate-api-docs.js");

test("generated API reference covers the public surfaces", () => {
    const md = generate();
    expect(md).toContain("lua_gc(");
    expect(md).toContain("luaL_newstate(");
    expect(md).toContain("## Version registry (`versions`)");
    expect(md).toContain("register(impl)");
    expect(md).toContain("lua_pushjsfunction");
    expect(md).toContain("LUA_VERSION_NUM");
    expect(md).toContain("Version profiles");
});

test("generated API reference is deterministic", () => {
    expect(generate()).toBe(generate());
});

test("docs/api.md is up to date", () => {
    expect(fs.readFileSync(OUTPUT, "utf8")).toBe(generate());
});

test("the hand-written guides exist and are linked", () => {
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    for (const name of ["migrating-from-c.md", "browser.md", "high-level-api.md"]) {
        const file = path.join(__dirname, "..", "docs", name);
        expect(fs.existsSync(file)).toBe(true);
        expect(readme).toContain("docs/" + name);
    }
    expect(readme).toContain("docs/api.md");
});
