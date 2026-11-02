"use strict";

/*
** Generates docs/api.md from the public `module.exports` assignments in src/.
** Signatures and descriptions are taken from the source declarations; no
** modules are evaluated, so generation has no side effects.
**
** Usage: node scripts/generate-api-docs.js [--check]
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUTPUT = path.join(ROOT, "docs", "api.md");

const MODULES = [
    {file: "lua.js", title: "Core C API (`lua`)"},
    {file: "lauxlib.js", title: "Auxiliary library (`lauxlib`)"},
    {file: "lualib.js", title: "Standard libraries (`lualib`)"},
    {file: "fengari.js", title: "Package entry (`fengari`)"},
    {file: "versions.js", title: "Version registry (`versions`)"},
    {file: "luaconf.js", title: "Configuration (`luaconf`)"}
];

const walk = function(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            out = out.concat(walk(full));
        else if (entry.isFile() && entry.name.endsWith(".js"))
            out.push(full);
    }
    return out;
};

const clean_comment = function(text) {
    let lines = text.split("\n").map(function(line) {
        return line.replace(/^\s*\/\*\*?/, "")
            .replace(/\*\/\s*$/, "")
            .replace(/^\s*\*\s?/, "")
            .replace(/^\s*\/\/\s?/, "")
            .trim();
    });
    lines = lines.filter(function(line) {
        return line.length > 0 &&
            !/^Copyright|^@license|^MIT$/.test(line);
    });
    return lines.join(" ").replace(/\s+/g, " ").trim();
};

const comment_before = function(lines, index) {
    let i = index - 1;
    while (i >= 0 && lines[i].trim() === "")
        i--;
    if (i < 0)
        return "";

    if (lines[i].trim().endsWith("*/")) {
        let end = i;
        while (i >= 0 && !lines[i].includes("/*"))
            i--;
        if (i < 0)
            return "";
        return clean_comment(lines.slice(i, end + 1).join("\n"));
    }

    let collected = [];
    while (i >= 0 && lines[i].trim().startsWith("//")) {
        collected.unshift(lines[i]);
        i--;
    }
    return clean_comment(collected.join("\n"));
};

const normalize_params = function(params) {
    return params.replace(/\s+/g, " ").trim();
};

const declaration_of = function(lines) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;

        if ((m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/.exec(line)))
            return {name: m[1], kind: "function", params: normalize_params(m[2]), line: i};
        if ((m = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(line)))
            return {name: m[1], kind: "function", params: normalize_params(m[2]), line: i};
        if ((m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(line)))
            return {name: m[1], kind: "function", params: normalize_params(m[2]), line: i};
        if ((m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/.exec(line)))
            return {name: m[1], kind: "function", params: m[2], line: i};
        if ((m = /^\s*class\s+([A-Za-z_$][\w$]*)/.exec(line)))
            return {name: m[1], kind: "class", params: "", line: i};
        if ((m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/.exec(line)))
            return {name: m[1], kind: "value", value: m[2].trim(), line: i};
    }
    return null;
};

const build_declarations = function(files) {
    const declarations = new Map();
    for (const file of files) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const decl = declaration_of([lines[i]]);
            if (!decl)
                continue;
            const entry = {
                name: decl.name,
                kind: decl.kind,
                params: decl.params || "",
                value: decl.value || "",
                source: rel,
                comment: comment_before(lines, i)
            };
            if (!declarations.has(decl.name))
                declarations.set(decl.name, entry);
        }
    }

    /* Resolve simple aliases (`const pushjs = pushc;`). */
    for (const entry of declarations.values()) {
        if (entry.kind !== "value" || !/^[A-Za-z_$][\w$]*$/.test(entry.value))
            continue;
        const target = declarations.get(entry.value);
        if (target && target.kind === "function") {
            entry.kind = "function";
            entry.params = target.params;
            entry.alias = target.name;
        } else if (target && target.kind === "class") {
            entry.kind = "class";
            entry.alias = target.name;
        }
    }
    return declarations;
};

const is_module_value = function(value) {
    return /^require\s*\(/.test(value);
};

const collect_exports = function(file, declarations) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const exports = new Map();
    const re = /^\s*module\.exports\.([A-Za-z_$][\w$]*)\s*=\s*([^;]+);?/;

    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m)
            continue;
        const name = m[1];
        if (name.startsWith("api_"))
            continue;
        const expression = m[2].trim();
        const decl = declarations.get(name);
        const comment = comment_before(lines, i) ||
            (decl ? decl.comment : "");

        let kind = "value";
        let params = "";
        let source = path.relative(ROOT, file).split(path.sep).join("/");
        let alias = null;

        if (is_module_value(expression)) {
            kind = "module";
            alias = expression;
        } else if (decl) {
            kind = decl.kind;
            params = decl.params;
            source = decl.source;
            alias = decl.alias || null;
            if (decl.kind === "value" && is_module_value(decl.value)) {
                kind = "module";
                alias = decl.value;
            }
        } else {
            const dotted = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expression);
            if (dotted)
                alias = expression;
        }
        if (!exports.has(name))
            exports.set(name, {name, kind, params, source, comment, alias, expression});
    }
    return exports;
};

const format_signature = function(entry) {
    if (entry.kind === "function")
        return entry.name + "(" + entry.params + ")";
    if (entry.kind === "class")
        return "class " + entry.name;
    if (entry.kind === "module")
        return entry.name;
    return entry.name;
};

const escape_table = function(value) {
    let s = String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
    if (s.length > 90)
        s = s.slice(0, 87) + "...";
    return s;
};

const render_module = function(spec, exports, declarations) {
    const list = Array.from(exports.values()).sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });
    const functions = list.filter(function(e) {
        return e.kind === "function" || e.kind === "class";
    });
    const values = list.filter(function(e) {
        return e.kind === "value" || e.kind === "module";
    });

    let out = "## " + spec.title + "\n\n";
    out += "Source: [`src/" + spec.file + "`](../src/" + spec.file + ")\n\n";

    if (functions.length > 0) {
        out += "### Functions and types\n\n";
        for (const entry of functions) {
            out += "- **`" + format_signature(entry) + "`**";
            if (entry.alias)
                out += " — alias of `" + entry.alias + "`";
            out += "  \n  `" + entry.source + "`";
            if (entry.comment)
                out += "\n\n  " + entry.comment;
            out += "\n";
        }
        out += "\n";
    }

    if (values.length > 0) {
        out += "### Values\n\n";
        out += "| Name | Source / value |\n| --- | --- |\n";
        for (const entry of values) {
            const decl = declarations.get(entry.name);
            const value = entry.alias || (decl && decl.value) || entry.expression;
            out += "| `" + entry.name + "` | `" + escape_table(value) + "` |\n";
        }
        out += "\n";
    }
    return out;
};

const generate = function() {
    const files = walk(SRC);
    const declarations = build_declarations(files);

    let out = "<!-- Generated by scripts/generate-api-docs.js. Do not edit by hand. -->\n\n";
    out += "# Fengari API reference\n\n";
    out += "Fengari mirrors the Lua 5.3 C API by name. This reference is generated from the\n";
    out += "public `module.exports` assignments and their source declarations; comments are\n";
    out += "included when present. For usage guidance see [the migration guide](migrating-from-c.md)\n";
    out += "and the [README](../README.md).\n\n";
    out += "The core functions operate on a `lua_State`; strings are byte arrays\n";
    out += "(`Uint8Array`), and errors cross JS boundaries as exceptions or `lua_pcall`\n";
    out += "status codes. Module-specific notes are in each section.\n\n";
    out += "This reference covers the C API and top-level exports. See the\n";
    out += "[high-level API guide](high-level-api.md) for `api`/`vfs` and the\n";
    out += "[browser guide](browser.md) for the bundle, workers and persistence.\n\n";

    for (const spec of MODULES) {
        const file = path.join(SRC, spec.file);
        if (!fs.existsSync(file))
            continue;
        const exports = collect_exports(file, declarations);
        out += render_module(spec, exports, declarations);
    }

    out += "## Version profiles\n\n";
    out += "The registry itself is documented above. Bundled profiles expose the following\n";
    out += "target surfaces (the parser and VM remain Lua 5.3):\n\n";
    out += "| Version | Highlights |\n| --- | --- |\n";
    out += "| 5.4 | `coroutine.close`, `warn`, the 5.4 `math.random`/`randomseed` API (xoshiro, per-state seeds) and `<const>`/`<close>` with `__close`, including the generic-for closing value and yielding `__close`. No 64-bit integers by default. |\n";
    out += "| 5.3 | Current core: integers, bitwise operators, `utf8`, `string.pack`, `table.move`. |\n";
    out += "| 5.2 | `bit32`; no `utf8`, `string.pack` or 5.3 `math`/`coroutine` additions. |\n";
    out += "| 5.1 | `unpack`, `loadstring`, `getfenv`/`setfenv`, `module`, `package.seeall`, `table.maxn/getn`, `string.gfind`, `package.loaders`. |\n\n";
    return out;
};

const main = function() {
    const check = process.argv.includes("--check");
    const generated = generate();
    if (check) {
        if (!fs.existsSync(OUTPUT)) {
            console.error("docs/api.md is missing; run `node scripts/generate-api-docs.js`");
            process.exitCode = 1;
            return;
        }
        const current = fs.readFileSync(OUTPUT, "utf8");
        if (current !== generated) {
            console.error("docs/api.md is out of date; run `node scripts/generate-api-docs.js`");
            process.exitCode = 1;
        }
        return;
    }
    fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
    fs.writeFileSync(OUTPUT, generated);
};

if (require.main === module)
    main();

module.exports.generate = generate;
module.exports.OUTPUT = OUTPUT;
