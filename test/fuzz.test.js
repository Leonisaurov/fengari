"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

test("parser and undump reject fuzzed chunks without throwing", () => {
    const out = execFileSync(process.execPath, [
        path.join(__dirname, "..", "scripts", "fuzz.js"),
        "--iterations=600",
        "--seed=12345"
    ], {
        encoding: "utf8",
        timeout: 60000
    });
    expect(out).toContain("without crashes");
});
