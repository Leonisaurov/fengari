#!/usr/bin/env node

/*
** Minimal CommonJS bundler for the browser build.
**
** It resolves the static `require("literal")` calls in src/, stubs Node
** built-ins and emits an IIFE that exposes the package as `globalThis.fengari`.
**
** Usage: node scripts/build-browser.js [--out=dist/fengari.js]
*/

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = "src/fengari.js";

let output = path.join(ROOT, "dist", "fengari.js");
for (const arg of process.argv.slice(2)) {
    const m = /^--out=(.+)$/.exec(arg);
    if (m)
        output = path.resolve(ROOT, m[1]);
    else {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const NODE_BUILTINS = new Set([
    "fs", "path", "os", "child_process", "tmp", "readline-sync"
]);

const modules = new Map();

const relative_id = function(full) {
    return path.relative(ROOT, full).split(path.sep).join("/");
};

const resolve_package = function(request) {
    let base = path.join(ROOT, "node_modules", request);
    let pkg = path.join(base, "package.json");
    if (fs.existsSync(pkg)) {
        let info = JSON.parse(fs.readFileSync(pkg, "utf8"));
        let main = info.main || "index.js";
        let full = path.join(base, main);
        if (!fs.existsSync(full) && fs.existsSync(full + ".js"))
            full += ".js";
        return relative_id(full);
    }
    if (fs.existsSync(base + ".js"))
        return relative_id(base + ".js");
    if (fs.existsSync(path.join(base, "index.js")))
        return relative_id(path.join(base, "index.js"));
    throw new Error(`cannot resolve package '${request}'`);
};

const resolve_request = function(from, request) {
    if (request.startsWith(".")) {
        let full = path.resolve(path.dirname(path.join(ROOT, from)), request);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory())
            full = path.join(full, "index.js");
        else if (!fs.existsSync(full) && fs.existsSync(full + ".js"))
            full += ".js";
        if (!fs.existsSync(full))
            throw new Error(`cannot resolve '${request}' from ${from}`);
        return relative_id(full);
    }
    if (NODE_BUILTINS.has(request))
        return `__stub__/${request}`;
    return resolve_package(request);
};

const add_module = function(id) {
    if (modules.has(id))
        return;
    if (id.startsWith("__stub__/")) {
        modules.set(id, { stub: id.slice("__stub__/".length) });
        return;
    }
    /* reserve the id before scanning so require cycles terminate */
    modules.set(id, { pending: true });
    try {
        let full = path.join(ROOT, id);
        let source = fs.readFileSync(full, "utf8");
        let map = {};
        let re = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
        let m;
        while ((m = re.exec(source))) {
            let request = m[2];
            let target = resolve_request(id, request);
            map[request] = target;
            add_module(target);
        }
        modules.set(id, { source: source, map: map });
    } catch (e) {
        modules.delete(id);
        throw e;
    }
};

add_module(ENTRY);

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const vlq_encode = function(value) {
    let v = value < 0 ? ((-value) << 1) | 1 : value << 1;
    let out = "";
    do {
        let digit = v & 31;
        v >>>= 5;
        if (v > 0)
            digit |= 32;
        out += BASE64[digit];
    } while (v > 0);
    return out;
};

/* ---------------------------------------------------------------------- */
/* conservative whitespace/comment minifier                                */
/* ---------------------------------------------------------------------- */

const REGEX_PREFIX = "([{,;:=!&|?+-*%^~<>";
const REGEX_WORDS = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await", "throw"
]);

const strip_source = function(source) {
    let out = "";
    let i = 0;
    let n = source.length;
    let at_line_start = true;
    let last_char = "";
    let last_word = "";
    let word = "";

    const copy_string = function(quote) {
        out += quote;
        i++;
        while (i < n) {
            let c = source[i++];
            out += c;
            if (c === "\\") {
                if (i < n)
                    out += source[i++];
            } else if (c === quote) {
                break;
            }
        }
    };

    const copy_template = function() {
        out += "`";
        i++;
        while (i < n) {
            let c = source[i++];
            out += c;
            if (c === "\\") {
                if (i < n)
                    out += source[i++];
            } else if (c === "`") {
                break;
            } else if (c === "$" && source[i] === "{") {
                out += "{";
                i++;
                let depth = 1;
                while (i < n && depth > 0) {
                    let ch = source[i];
                    if (ch === "'" || ch === "\"") {
                        copy_string(ch);
                    } else if (ch === "`") {
                        copy_template();
                    } else if (ch === "/" && source[i + 1] === "/") {
                        while (i < n && source[i] !== "\n")
                            out += source[i++];
                    } else if (ch === "/" && source[i + 1] === "*") {
                        out += source[i++];
                        out += source[i++];
                        while (i < n && !(source[i] === "*" && source[i + 1] === "/"))
                            out += source[i++];
                        if (i < n) {
                            out += source[i++];
                            out += source[i++];
                        }
                    } else {
                        out += ch;
                        i++;
                        if (ch === "{")
                            depth++;
                        else if (ch === "}")
                            depth--;
                    }
                }
            }
        }
    };

    const copy_regex = function() {
        out += "/";
        i++;
        let in_class = false;
        while (i < n) {
            let c = source[i++];
            out += c;
            if (c === "\\") {
                if (i < n)
                    out += source[i++];
            } else if (c === "[") {
                in_class = true;
            } else if (c === "]") {
                in_class = false;
            } else if (c === "/" && !in_class) {
                break;
            } else if (c === "\n") {
                break;
            }
        }
        while (i < n && /[a-z]/i.test(source[i]))
            out += source[i++];
    };

    const regex_allowed = function() {
        if (last_char === "")
            return true;
        if (REGEX_PREFIX.indexOf(last_char) !== -1)
            return true;
        return REGEX_WORDS.has(last_word);
    };

    while (i < n) {
        let c = source[i];

        if (at_line_start && (c === " " || c === "\t" || c === "\r")) {
            i++;
            continue;
        }
        if (at_line_start && c === "\n") {
            out += "\n";
            i++;
            continue;
        }
        at_line_start = false;

        if (c === "\n") {
            out += c;
            i++;
            at_line_start = true;
            last_char = "\n";
            last_word = "";
            continue;
        }
        if (c === "'" || c === "\"") {
            copy_string(c);
            last_char = c;
            last_word = "";
            continue;
        }
        if (c === "`") {
            copy_template();
            last_char = "`";
            last_word = "";
            continue;
        }
        if (c === "/" && source[i + 1] === "/") {
            while (i < n && source[i] !== "\n")
                i++;
            continue;
        }
        if (c === "/" && source[i + 1] === "*") {
            i += 2;
            while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
                if (source[i] === "\n")
                    out += "\n";
                i++;
            }
            i += 2;
            continue;
        }
        if (c === "/" && regex_allowed()) {
            copy_regex();
            last_char = "/";
            last_word = "";
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            let start = i;
            while (i < n && /[A-Za-z0-9_$]/.test(source[i]))
                i++;
            word = source.slice(start, i);
            out += word;
            last_word = word;
            last_char = word[word.length - 1];
            continue;
        }
        out += c;
        i++;
        if (c !== " " && c !== "\t" && c !== "\r") {
            if (!/[A-Za-z0-9_$]/.test(c))
                last_word = "";
            last_char = c;
        }
    }

    return out.replace(/\n{3,}/g, "\n\n");
};

/* ---------------------------------------------------------------------- */
/* output                                                                  */
/* ---------------------------------------------------------------------- */

const emit = function(minify) {
    let lines = [];
    let mappings = [];
    let sources = [];
    let contents = [];
    let prev_source = 0;
    let prev_line = 0;

    const push = function(line, source_index, source_line) {
        lines.push(line);
        if (source_index === undefined) {
            mappings.push("");
        } else {
            let segment = vlq_encode(0) +
                vlq_encode(source_index - prev_source) +
                vlq_encode(source_line - prev_line) +
                vlq_encode(0);
            prev_source = source_index;
            prev_line = source_line;
            mappings.push(segment);
        }
    };

    push("/* Generated by scripts/build-browser.js. Do not edit. */");
    push("(function(global) {");
    push('"use strict";');
    push("var modules = {");

    for (const [id, mod] of modules) {
        if (mod.stub) {
            if (minify) {
                push(`${JSON.stringify(id)}:function(module,exports,require){throw new Error(${JSON.stringify(mod.stub + " is not available in the browser")});},`);
            } else {
                push(`${JSON.stringify(id)}: function(module, exports, require) {`);
                push(`    throw new Error(${JSON.stringify(mod.stub + " is not available in the browser")});`);
                push("},");
            }
            continue;
        }

        let source = minify ? strip_source(mod.source) : mod.source;
        let source_index = sources.length;
        sources.push(id);
        contents.push(mod.source);

        if (minify) {
            push(`${JSON.stringify(id)}:function(module,exports,__require){var map=${JSON.stringify(mod.map)};var require=function(name){if(Object.prototype.hasOwnProperty.call(map,name))return __require(map[name]);throw new Error("Cannot find module '"+name+"'");};`);
        } else {
            push(`${JSON.stringify(id)}: function(module, exports, __require) {`);
            push("    var map = " + JSON.stringify(mod.map) + ";");
            push("    var require = function(name) {");
            push("        if (Object.prototype.hasOwnProperty.call(map, name))");
            push("            return __require(map[name]);");
            push("        throw new Error(\"Cannot find module '\" + name + \"'\");");
            push("    };");
        }

        let source_lines = source.split("\n");
        for (let j = 0; j < source_lines.length; j++)
            push(source_lines[j], source_index, j);

        push("},");
    }

    push("};");
    push("var cache = {};");
    push("function req(id) {");
    push("    if (cache[id]) return cache[id].exports;");
    push("    var module = cache[id] = { exports: {} };");
    push("    modules[id](module, module.exports, req);");
    push("    return module.exports;");
    push("}");
    push(`var fengari = req(${JSON.stringify(ENTRY)});`);
    push("if (typeof module === \"object\" && module.exports) module.exports = fengari;");
    push("else global.fengari = fengari;");
    push("})(typeof globalThis !== \"undefined\" ? globalThis : this);");

    let code = lines.join("\n") + "\n";
    let map = null;
    if (!minify) {
        map = {
            version: 3,
            file: path.basename(output),
            sources: sources,
            sourcesContent: contents,
            names: [],
            mappings: mappings.join(";")
        };
        code += `//# sourceMappingURL=${path.basename(output)}.map\n`;
    }
    return { code: code, map: map };
};

fs.mkdirSync(path.dirname(output), { recursive: true });

let full = emit(false);
fs.writeFileSync(output, full.code);
fs.writeFileSync(output + ".map", JSON.stringify(full.map));

let min_output = output.replace(/\.js$/, ".min.js");
let slim = emit(true);
fs.writeFileSync(min_output, slim.code);

console.log(`${relative_id(output)} (${modules.size} modules, ${(full.code.length / 1024).toFixed(0)} KiB)`);
console.log(`${relative_id(min_output)} (${(slim.code.length / 1024).toFixed(0)} KiB)`);
