#!/usr/bin/env node

/*
** Print a markdown changelog for commits since the last tag (or --since).
** This is a drafting aid; edit NEWS by hand before a release.
**
** Usage: node scripts/changelog.js [--since=REF] [--version=X.Y.Z]
*/

"use strict";

const { execFileSync } = require("child_process");

let since = null;
let version = null;
for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = /^--since=(.+)$/.exec(arg)))
        since = m[1];
    else if ((m = /^--version=(.+)$/.exec(arg)))
        version = m[1];
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

if (since === null) {
    try {
        since = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
            encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    } catch (e) {
        since = "";  /* no tags yet: list all commits */
    }
}

const range = since ? `${since}..HEAD` : "HEAD";
const output = execFileSync("git", ["log", `--pretty=format:%s`, range], {
    encoding: "utf8"
});
const groups = {
    feat: "Features",
    fix: "Fixes",
    perf: "Performance",
    docs: "Documentation",
    test: "Tests",
    refactor: "Refactoring",
    chore: "Maintenance"
};
const items = {};
for (const line of output.split("\n")) {
    if (!line.trim())
        continue;
    const m = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(line);
    const key = m && groups[m[1]] ? m[1] : "other";
    const text = m ? m[2] : line;
    (items[key] = items[key] || []).push(text);
}

const date = new Date().toISOString().slice(0, 10);
console.log(`## ${version || "unreleased"} (${date})`);
console.log("");
console.log(since ? `Commits since \`${since}\`: ${range}` : `All commits: ${range}`);
for (const key of Object.keys(groups).concat(["other"])) {
    if (!items[key])
        continue;
    console.log(`\n### ${key === "other" ? "Other" : groups[key]}\n`);
    for (const text of items[key])
        console.log(`- ${text}`);
}
