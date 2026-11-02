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

test("the migration guide exists and is linked", () => {
    const guide = path.join(__dirname, "..", "docs", "migrating-from-c.md");
    expect(fs.existsSync(guide)).toBe(true);
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    expect(readme).toContain("docs/migrating-from-c.md");
    expect(readme).toContain("docs/api.md");
});
