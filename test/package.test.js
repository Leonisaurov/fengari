"use strict";

const fs   = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg  = require("../package.json");

test("package entry points exist and are exported", () => {
    expect(pkg.type).toBe("commonjs");
    expect(pkg.main).toBe("src/fengari.js");
    expect(pkg.module).toBe("src/fengari.mjs");
    expect(pkg.types).toBe("types/fengari.d.ts");

    for (const file of [pkg.main, pkg.module, pkg.types])
        expect(fs.existsSync(path.join(root, file))).toBe(true);

    expect(pkg.exports["."].require).toBe("./src/fengari.js");
    expect(pkg.exports["."].import).toBe("./src/fengari.mjs");
    expect(pkg.exports["."].types).toBe("./types/fengari.d.ts");
    expect(pkg.exports["./versions"]).toBe("./src/versions.js");
    expect(pkg.exports["./src/*"]).toBe("./src/*");
    expect(pkg.exports["./package.json"]).toBe("./package.json");
});

test("published files include the runtime and exclude tests", () => {
    for (const entry of ["src/", "types/", "dist/", "docs/", "bench/",
        "README.md", "LICENSE", "NEWS"])
        expect(pkg.files).toContain(entry);

    expect(pkg.files.some((entry) => entry.startsWith("test"))).toBe(false);
    expect(pkg.files.some((entry) => entry.startsWith("coverage"))).toBe(false);
    expect(pkg.engines.node).toMatch(/^>=/);
});

test("runtime dependencies are declared", () => {
    for (const name of ["readline-sync", "tmp"])
        expect(pkg.dependencies).toHaveProperty(name);
    for (const name of ["@types/node", "eslint", "globals", "jest", "sprintf-js", "typescript"])
        expect(pkg.devDependencies).toHaveProperty(name);
    expect(pkg.dependencies).not.toHaveProperty("sprintf-js");
});

test("the typecheck config covers the declaration consumer", () => {
    const tsconfig = require("../tsconfig.types.json");
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.include).toContain("test/types/**/*.ts");
    expect(fs.existsSync(path.join(root, "test/types/consumer.ts"))).toBe(true);
    expect(pkg.scripts.typecheck).toBe("tsc -p tsconfig.types.json");
    expect(pkg.scripts["typecheck:js"]).toBe("tsc -p tsconfig.checkjs.json");
    expect(pkg.scripts.check).toContain("tsc -p tsconfig.types.json");
    expect(pkg.scripts.check).toContain("tsc -p tsconfig.checkjs.json");
});
