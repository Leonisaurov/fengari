#!/usr/bin/env node

/*
** Browser integration test driven through the Chrome DevTools Protocol.
**
** It builds dist/fengari.js, serves it from a tiny local HTTP server, launches
** Brave in headless mode (falling back to Chromium/Chrome) and runs the
** browser-only scenarios: io/os over the VFS, mounted require/dofile,
** localStorage, IndexedDB, OPFS, a real Web Worker and the sandbox.
**
** Usage: node scripts/browser-test.js [--keep]
**        BRAVE_BIN=/path/to/brave node scripts/browser-test.js
*/

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist", "fengari.js");
const MIN_BUNDLE = path.join(ROOT, "dist", "fengari.min.js");

const keep = process.argv.includes("--keep");

/* ---------------------------------------------------------------------- */
/* bundle and HTTP server                                                  */
/* ---------------------------------------------------------------------- */

execFileSync(process.execPath, [path.join(__dirname, "build-browser.js")], {
    cwd: ROOT,
    stdio: "inherit"
});

const page = `<!doctype html>
<meta charset="utf-8">
<title>fengari browser tests</title>
<script src="/bundle.js"></script>
`;

const min_page = `<!doctype html>
<meta charset="utf-8">
<title>fengari minified bundle</title>
<script src="/bundle.min.js"></script>
`;

const MODULES = {
    "/modules/greet.lua": 'return { hello = function() return "hi" end }',
    "/modules/cjsmod.js": "module.exports = { value: 21 };",
    "/modules/fnmod.js": "module.exports = function(x) { return x * 2; };",
    "/modules/esmmod.mjs": "export default { value: 7 };"
};

const HEADERS = {
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp"
};

const server = http.createServer(function(req, res) {
    if (Object.prototype.hasOwnProperty.call(MODULES, req.url)) {
        res.writeHead(200, Object.assign({
            "content-type": /\.m?js$/.test(req.url)
                ? "text/javascript; charset=utf-8"
                : "text/plain; charset=utf-8"
        }, HEADERS));
        res.end(MODULES[req.url]);
        return;
    }
    if (req.url === "/min.html") {
        res.writeHead(200, Object.assign({
            "content-type": "text/html; charset=utf-8"
        }, HEADERS));
        res.end(min_page);
        return;
    }
    if (req.url === "/bundle.min.js") {
        res.writeHead(200, Object.assign({
            "content-type": "text/javascript; charset=utf-8"
        }, HEADERS));
        res.end(fs.readFileSync(MIN_BUNDLE));
        return;
    }
    if (req.url === "/bundle.js.map") {
        res.writeHead(200, Object.assign({
            "content-type": "application/json; charset=utf-8"
        }, HEADERS));
        res.end(fs.readFileSync(BUNDLE + ".map"));
        return;
    }
    if (req.url === "/bundle.js") {
        res.writeHead(200, Object.assign({
            "content-type": "text/javascript; charset=utf-8"
        }, HEADERS));
        res.end(fs.readFileSync(BUNDLE));
        return;
    }
    if (req.url !== "/" && req.url !== "/index.html") {
        res.writeHead(404, Object.assign({
            "content-type": "text/plain; charset=utf-8"
        }, HEADERS));
        res.end("not found");
        return;
    }
    res.writeHead(200, Object.assign({
        "content-type": "text/html; charset=utf-8"
    }, HEADERS));
    res.end(page);
});

/* ---------------------------------------------------------------------- */
/* browser discovery and launch                                            */
/* ---------------------------------------------------------------------- */

const which = function(bin) {
    let r = spawnSync(bin, ["--version"], { stdio: "ignore" });
    return r.status === 0;
};

const find_browser = function() {
    let candidates = [
        process.env.BRAVE_BIN,
        "brave",
        "/usr/bin/brave",
        "brave-browser",
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable"
    ].filter(Boolean);
    for (let bin of candidates) {
        if (which(bin))
            return bin;
    }
    return null;
};

const wait_for_port = function(user_dir, timeout) {
    let file = path.join(user_dir, "DevToolsActivePort");
    let start = Date.now();
    return new Promise(function(resolve, reject) {
        let poll = function() {
            if (fs.existsSync(file)) {
                let lines = fs.readFileSync(file, "utf8").split("\n");
                let port = parseInt(lines[0], 10);
                if (port > 0) {
                    resolve(port);
                    return;
                }
            }
            if (Date.now() - start > timeout) {
                reject(new Error("timed out waiting for the DevTools port"));
                return;
            }
            setTimeout(poll, 100);
        };
        poll();
    });
};

const json = async function(url, options) {
    let response = await fetch(url, options);
    if (!response.ok)
        throw new Error(`${url}: ${response.status}`);
    return response.json();
};

/* ---------------------------------------------------------------------- */
/* tiny CDP client                                                         */
/* ---------------------------------------------------------------------- */

class CDP {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.next_id = 0;
        this.pending = new Map();
        this.events = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.addEventListener("open", () => resolve());
            this.ws.addEventListener("error", (event) => reject(event.error || new Error("websocket error")));
            this.ws.addEventListener("message", (event) => {
                let message = JSON.parse(event.data);
                if (message.id !== undefined) {
                    let pending = this.pending.get(message.id);
                    if (!pending)
                        return;
                    this.pending.delete(message.id);
                    if (message.error)
                        pending.reject(new Error(message.error.message));
                    else
                        pending.resolve(message.result);
                    return;
                }
                let listeners = this.events.get(message.method);
                if (listeners) {
                    this.events.delete(message.method);
                    for (let listener of listeners)
                        listener(message.params);
                }
            });
        });
    }

    send(method, params) {
        let id = ++this.next_id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }

    once(method) {
        return new Promise((resolve) => {
            let listeners = this.events.get(method) || [];
            listeners.push(resolve);
            this.events.set(method, listeners);
        });
    }

    async evaluate(expression) {
        let result = await this.send("Runtime.evaluate", {
            expression: expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        if (result.exceptionDetails) {
            let details = result.exceptionDetails;
            let text = details.exception && details.exception.description
                ? details.exception.description
                : details.text;
            if (details.lineNumber !== undefined) {
                let line = expression.split("\n")[details.lineNumber] || "";
                text += ` (line ${details.lineNumber + 1}, column ${(details.columnNumber || 0) + 1})\n${line}`;
            }
            throw new Error(text);
        }
        return result.result.value;
    }

    close() {
        if (this.ws)
            this.ws.close();
    }
}

/* ---------------------------------------------------------------------- */
/* tests that run inside the page                                          */
/* ---------------------------------------------------------------------- */

const WORKER_LUA = [
    'local f = assert(io.open("/memory.txt", "r"))',
    'local s = f:read("a")',
    'f:close()',
    'assert(os.remove("/memory.txt"))',
    'return s'
].join(" ");

const WORKER_OPFS_LUA = [
    'local f = assert(io.open("/sub/worker.txt", "r"))',
    'local s = f:read("a")',
    'f:close()',
    'local a = assert(io.open("/sub/worker.txt", "a"))',
    'a:write("more")',
    'a:close()',
    'return s'
].join(" ");

const WORKER_SOURCE = `
importScripts(location.origin + "/bundle.js");
(async function() {
    try {
        const F = fengari;
        const sab = new SharedArrayBuffer(16);
        const view = new Int32Array(sab);
        Atomics.store(view, 0, 7);

        F.vfs.mount("/memory.txt", "worker data");
        let state = F.api.createState();
        const memory_value = state.run(${JSON.stringify(WORKER_LUA)});
        state.close();

        const root = await navigator.storage.getDirectory();
        const dirname = "fengari-opfs-" + Math.random().toString(36).slice(2);
        const dir = await root.getDirectoryHandle(dirname, { create: true });
        const sub = await dir.getDirectoryHandle("sub", { create: true });
        const handle = await sub.getFileHandle("worker.txt", { create: true });
        let writable = await handle.createWritable();
        await writable.write("seed");
        await writable.close();

        const mounted = await F.vfs.mountOPFS(dir, { files: ["nested/new.txt"] });
        state = F.api.createState();
        const opfs_value = state.run(${JSON.stringify(WORKER_OPFS_LUA)});
        const created = state.run(
            "local f = assert(io.open('/nested/new.txt', 'w'))" +
            " f:write('created') f:close() return true");
        state.close();
        F.vfs.unmountOPFS();

        const text = await (await handle.getFile()).text();
        const nested = await dir.getDirectoryHandle("nested");
        const created_handle = await nested.getFileHandle("new.txt");
        const created_text = await (await created_handle.getFile()).text();
        await root.removeEntry(dirname, { recursive: true });

        postMessage({
            ok: memory_value === "worker data" && opfs_value === "seed" &&
                text === "seedmore" && created === true &&
                created_text === "created" && mounted === 2 &&
                Atomics.load(view, 0) === 7 && self.crossOriginIsolated,
            memory_value: memory_value,
            opfs_value: opfs_value,
            text: text,
            created_text: created_text,
            mounted: mounted
        });
    } catch (e) {
        postMessage({ ok: false, error: String(e && e.stack || e) });
    }
})();
`;

const SYNC_WORKER_SOURCE = `
importScripts(location.origin + "/bundle.js");
self.onmessage = (event) => {
    const { sab, port } = event.data;
    const F = fengari;
    const bridge = F.api.createSyncBridge(port, sab);
    const state = F.api.createState();
    try {
        state.pushJS(bridge.call);
        F.lua.lua_setglobal(state.L, "hostCall");
        const a = state.run("return hostCall('add', 2, 3)");
        const b = state.run("return hostCall('double', 10)");
        postMessage({ kind: "done", a: a, b: b });
    } catch (e) {
        postMessage({ kind: "error", error: String(e && e.stack || e) });
    } finally {
        state.close();
        bridge.close();
    }
};
`;

const PAGE_TESTS = `(async function() {
    const F = window.fengari;
    const results = [];
    const assert = (condition, message) => {
        if (!condition) throw new Error(message || "assertion failed");
    };
    const test = async (name, fn) => {
        try {
            await fn();
            results.push({ name: name, ok: true });
        } catch (e) {
            results.push({ name: name, ok: false, error: String(e && e.stack || e) });
        }
    };

    await test("environment", () => {
        assert(typeof process === "undefined", "process should be undefined");
        assert(typeof window !== "undefined", "window is missing");
        assert(F && F.lua && F.lauxlib && F.lualib && F.api && F.vfs, "bundle is incomplete");
    });

    await test("io and os over the VFS", () => {
        F.vfs.reset();
        F.vfs.mount("/dir/data.txt", "alpha\\n42\\nomega");
        F.vfs.mount("/dir/lines.txt", "one\\ntwo\\n");
        F.vfs.setEnv("HOME", "/home/lua");

        const state = F.api.createState();
        try {
            const out = state.run(
                'local f = assert(io.open("/dir/data.txt", "r"))' +
                ' local first = f:read("l")' +
                ' local n = f:read("n")' +
                ' local rest = f:read("a")' +
                ' f:close()' +
                ' local w = assert(io.open("/dir/out.txt", "w"))' +
                ' w:write("written") w:close()' +
                ' local lines = {}' +
                ' for line in io.lines("/dir/lines.txt") do lines[#lines + 1] = line end' +
                ' local tmp = assert(io.tmpfile()) tmp:write("tmp") tmp:seek("set")' +
                ' local t = tmp:read("a") tmp:close()' +
                ' assert(os.rename("/dir/out.txt", "/dir/moved.txt"))' +
                ' assert(os.remove("/dir/moved.txt"))' +
                ' assert(os.getenv("HOME") == "/home/lua")' +
                ' local name = os.tmpname()' +
                ' return first, n, rest, table.concat(lines, ","), t, type(name)'
            );
            assert(out[0] === "alpha", "line: " + out[0]);
            assert(out[1] === 42, "number: " + out[1]);
            assert(out[2] === "\\nomega", "rest: " + JSON.stringify(out[2]));
            assert(out[3] === "one,two", "lines: " + out[3]);
            assert(out[4] === "tmp", "tmpfile: " + out[4]);
            assert(out[5] === "string", "tmpname: " + out[5]);
        } finally {
            state.close();
        }
    });

    await test("mounted require and dofile do not use XHR", () => {
        F.vfs.reset();
        F.vfs.mount("/lua/mod.lua", "return { value = 5 }");
        F.vfs.mount("/lua/chunk.lua", "return 6 * 7");
        F.vfs.mount("/lua/jsmod.js",
            "return { luaopen_jsmod: function(L) { fengari.lua.lua_pushinteger(L, 7); return 1; } };");

        const previous_network = F.vfs.allowNetwork(false);
        const Original = window.XMLHttpRequest;
        let xhr_calls = 0;
        window.XMLHttpRequest = function() {
            xhr_calls++;
            throw new Error("XHR should not be used for mounted modules");
        };

        const state = F.api.createState();
        try {
            const out = state.run(
                'package.path = "/lua/?.lua"' +
                ' package.jspath = "/lua/?.js"' +
                ' local m = require("mod")' +
                ' local j = require("jsmod")' +
                ' local c = dofile("/lua/chunk.lua")' +
                ' return m.value, j, c'
            );
            assert(out[0] === 5, "lua module: " + out[0]);
            assert(out[1] === 7, "js module: " + out[1]);
            assert(out[2] === 42, "dofile: " + out[2]);
            assert(xhr_calls === 0, "XHR was used " + xhr_calls + " times");
        } finally {
            state.close();
            window.XMLHttpRequest = Original;
            F.vfs.allowNetwork(previous_network);
        }
    });

    await test("localStorage persistence", () => {
        F.vfs.reset();
        F.vfs.mount("/ls.txt", "ls-data");
        assert(F.vfs.saveToStorage("fengari-cdp") === 1, "save count");
        F.vfs.reset();
        assert(F.vfs.loadFromStorage("fengari-cdp") === 1, "load count");
        assert(F.to_jsstring(F.vfs.readFile("/ls.txt")) === "ls-data", "restored data");
        F.vfs.clearStorage("fengari-cdp");
        assert(F.vfs.loadFromStorage("fengari-cdp") === 0, "cleared");
    });

    await test("IndexedDB persistence", async () => {
        F.vfs.reset();
        F.vfs.mount("/idb.txt", "idb-data");
        assert(await F.vfs.saveToIndexedDB("fengari-cdp") === 1, "idb save");
        F.vfs.reset();
        assert(await F.vfs.loadFromIndexedDB("fengari-cdp") === 1, "idb load");
        assert(F.to_jsstring(F.vfs.readFile("/idb.txt")) === "idb-data", "idb data");
        await F.vfs.clearFromIndexedDB("fengari-cdp");
        assert(await F.vfs.loadFromIndexedDB("fengari-cdp") === 0, "idb cleared");
    });

    await test("OPFS persistence", async () => {
        assert(navigator.storage && navigator.storage.getDirectory, "OPFS is unavailable");
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("fengari-cdp", { create: true });

        F.vfs.reset();
        F.vfs.mount("/opfs.txt", "opfs-data");
        assert(await F.vfs.saveToOPFS(dir, "snap") === 1, "opfs save");
        F.vfs.reset();
        assert(await F.vfs.loadFromOPFS(dir, "snap") === 1, "opfs load");
        assert(F.to_jsstring(F.vfs.readFile("/opfs.txt")) === "opfs-data", "opfs data");
        await F.vfs.clearFromOPFS(dir, "snap");
        assert(await F.vfs.loadFromOPFS(dir, "snap") === 0, "opfs cleared");
    });

    await test("direct OPFS mount is rejected on the main thread", async () => {
        const root = await navigator.storage.getDirectory();
        let message = "";
        try {
            await F.vfs.mountOPFS(root, { files: ["fengari-probe.txt"] });
        } catch (e) {
            message = e.message;
        }
        assert(/worker/i.test(message), "expected a worker-only error, got: " + message);
    });

    await test("SharedArrayBuffer and cross-origin isolation", () => {
        assert(self.crossOriginIsolated === true, "not cross-origin isolated");
        assert(typeof SharedArrayBuffer === "function", "SharedArrayBuffer is unavailable");
        const sab = new SharedArrayBuffer(16);
        const view = new Int32Array(sab);
        Atomics.store(view, 0, 42);
        assert(Atomics.load(view, 0) === 42, "Atomics round trip");
    });

    await test("a real Web Worker uses the bundle", async () => {
        const source = ${JSON.stringify(WORKER_SOURCE)};
        const blob = new Blob([source], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        const result = await new Promise((resolve) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => resolve({ ok: false, error: event.message });
        });
        worker.terminate();
        URL.revokeObjectURL(url);
        assert(result.ok, result.error || JSON.stringify(result));
    });

    await test("worker RPC through the async bridge", async () => {
        const source = [
            'importScripts(location.origin + "/bundle.js");',
            'const pending = new Map();',
            'let next = 0;',
            'self.onmessage = (event) => {',
            '    if (event.data.id !== undefined && pending.has(event.data.id)) {',
            '        pending.get(event.data.id)(event.data.value);',
            '        pending.delete(event.data.id);',
            '    }',
            '};',
            'function hostAdd(a, b) {',
            '    return new Promise((resolve) => {',
            '        const id = ++next;',
            '        pending.set(id, resolve);',
            '        postMessage({ id: id, op: "add", a: a, b: b });',
            '    });',
            '}',
            'const F = fengari;',
            'const state = F.api.createState();',
            'state.pushAsyncJS(hostAdd);',
            'F.lua.lua_setglobal(state.L, "hostAdd");',
            'state.runAsync("return hostAdd(2, 3)").then(',
            '    (value) => postMessage({ kind: "done", value: value }),',
            '    (error) => postMessage({ kind: "done", error: String(error) })',
            ');'
        ].join("\\n");
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        const worker = new Worker(url);
        const result = await new Promise((resolve, reject) => {
            worker.onmessage = (event) => {
                if (event.data.op === "add")
                    worker.postMessage({ id: event.data.id, value: event.data.a + event.data.b });
                else if (event.data.kind === "done")
                    resolve(event.data);
            };
            worker.onerror = (event) => reject(new Error(event.message));
        });
        worker.terminate();
        URL.revokeObjectURL(url);
        assert(result.error === undefined, result.error);
        assert(result.value === 5, "worker RPC value: " + result.value);
    });

    await test("synchronous worker RPC with SharedArrayBuffer", async () => {
        const shared = new SharedArrayBuffer(65536);
        const channel = new MessageChannel();
        const server = F.api.serveSyncBridge(channel.port1, shared, async (op, a, b) => {
            if (op === "add")
                return a + b;
            if (op === "double") {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return a * 2;
            }
            throw new Error("unknown operation: " + op);
        });

        const source = ${JSON.stringify(SYNC_WORKER_SOURCE)};
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        const worker = new Worker(url);
        try {
            const result = await new Promise((resolve, reject) => {
                worker.onmessage = (event) => {
                    if (event.data.kind === "done")
                        resolve(event.data);
                    else if (event.data.kind === "error")
                        reject(new Error(event.data.error));
                };
                worker.onerror = (event) => reject(new Error(event.message));
                worker.postMessage({ sab: shared, port: channel.port2 }, [channel.port2]);
            });
            assert(result.a === 5, "sync add: " + result.a);
            assert(result.b === 20, "sync double: " + result.b);
        } finally {
            worker.terminate();
            URL.revokeObjectURL(url);
            server.close();
        }
    });

    await test("stdout handlers, dates and process failures", () => {
        const lines = [];
        const previous = F.vfs.setStdout((line) => lines.push(line));
        try {
            const state = F.api.createState();
            try {
                state.run('io.write("captured\\\\n")');
                assert(state.run('return os.date("!%Y-%m-%dT%H:%M:%SZ", 0)') === "1970-01-01T00:00:00Z", "date");
                assert(state.run('return os.execute()') === false, "os.execute availability");
                const failures = state.run(
                    'local ok1 = pcall(io.popen, "true")' +
                    ' local ok2 = pcall(os.exit, 0)' +
                    ' local r, m, c = os.execute("true")' +
                    ' return ok1, ok2, r, type(m), c ~= 0'
                );
                assert(failures[0] === false, "popen should fail");
                assert(failures[1] === false, "os.exit should fail");
                assert(failures[2] === null, "os.execute should return nil");
                assert(failures[3] === "string", "os.execute message");
                assert(failures[4] === true, "os.execute errno");
            } finally {
                state.close();
            }
            F.vfs.flush();
        } finally {
            F.vfs.setStdout(previous);
        }
        assert(lines[0] === "captured", "stdout: " + JSON.stringify(lines));
    });

    await test("minified bundle and source map work", async () => {
        const map = await (await fetch("/bundle.js.map")).json();
        assert(map.version === 3, "source map version");
        assert(map.sources.length > 0 && map.mappings.length > 0, "source map contents");

        const frame = document.createElement("iframe");
        frame.src = "/min.html";
        const loaded = new Promise((resolve, reject) => {
            frame.onload = resolve;
            frame.onerror = reject;
        });
        document.body.appendChild(frame);
        await loaded;
        try {
            const win = frame.contentWindow;
            assert(win.fengari, "minified bundle did not load");
            const state = win.fengari.api.createState();
            try {
                assert(state.run("return 6 * 7") === 42, "minified run");
            } finally {
                state.close();
            }
        } finally {
            frame.remove();
        }
    });

    await test("async require fetches modules through an import map", async () => {
        const state = F.api.createState();
        try {
            state.installAsyncModules({ base: "/modules/" });
            assert(await state.runAsync('return require("greet").hello()') === "hi", "base fetch");

            state.installAsyncModules({
                map: { alias: "/modules/greet.lua" },
                fetch: async (name, url) => {
                    const response = await fetch(url);
                    return response.ok ? response.text() : null;
                }
            });
            assert(await state.runAsync('return require("alias").hello()') === "hi", "import map");

            let message = "";
            try {
                await state.runAsync('return require("missing")');
            } catch (e) {
                message = e.message;
            }
            assert(/not found/.test(message), "missing module: " + message);
        } finally {
            state.close();
        }
    });

    await test("async require loads CommonJS and ES modules", async () => {
        const state = F.api.createState();
        try {
            state.installAsyncModules({
                js: {
                    map: {
                        cjs: "/modules/cjsmod.js",
                        fn: "/modules/fnmod.js",
                        esm: { url: "/modules/esmmod.mjs", format: "esm" }
                    }
                }
            });
            assert(await state.runAsync('return require("cjs").value') === 21, "cjs value");
            assert(await state.runAsync('return require("esm").value') === 7, "esm value");
            assert(await state.runAsync('return require("fn")(4)') === 8, "cjs function");
        } finally {
            state.close();
        }
    });

    await test("loadFromURL fetches a module into the VFS", async () => {
        F.vfs.reset();
        const size = await F.vfs.loadFromURL("/bundle.js", "/downloaded.js");
        assert(size > 1000, "downloaded size: " + size);
        assert(F.vfs.readFile("/downloaded.js").length === size, "mounted data");
    });

    await test("async JS functions resolve Promises", async () => {
        const state = F.api.createState();
        try {
            state.pushAsyncJS(async (url) => {
                const response = await fetch(url);
                return response.status;
            });
            F.lua.lua_setglobal(state.L, "fetchStatus");
            const status = await state.runAsync('return fetchStatus("/bundle.js")');
            assert(status === 200, "fetch status: " + status);

            state.pushAsyncJS(async (ms) => {
                await new Promise((resolve) => setTimeout(resolve, ms));
                return ms;
            });
            F.lua.lua_setglobal(state.L, "delay");
            const sum = await state.runAsync("return delay(1) + delay(2)");
            assert(sum === 3, "delays: " + sum);

            state.pushAsyncJS(async () => { throw new Error("browser boom"); });
            F.lua.lua_setglobal(state.L, "fail");
            let message = "";
            try {
                await state.runAsync("return fail()");
            } catch (e) {
                message = e.message;
            }
            assert(/browser boom/.test(message), "rejection: " + message);
        } finally {
            state.close();
        }
    });

    await test("debug.debug uses window.prompt in the browser", () => {
        const state = F.api.createState();
        const previous = window.prompt;
        const inputs = ["x = 1 + 1", "cont"];
        window.prompt = () => inputs.length > 0 ? inputs.shift() : null;
        try {
            state.run("debug.debug()");
            assert(state.run("return x") === 2, "debug.debug assignment");
        } finally {
            window.prompt = previous;
            state.close();
        }
    });

    await test("sandbox limits run in the browser", () => {
        const box = F.api.sandbox({ instructions: 20000 });
        try {
            let message = "";
            try {
                box.run("while true do end");
            } catch (e) {
                message = e.message;
            }
            assert(/instruction limit/.test(message), "instruction limit: " + message);
            assert(box.run("return 7") === 7, "state survives");
        } finally {
            box.close();
        }
    });

    return results;
})()`;

/* ---------------------------------------------------------------------- */
/* main                                                                    */
/* ---------------------------------------------------------------------- */

const main = async function() {
    const browser_bin = find_browser();
    if (!browser_bin) {
        console.error("Brave/Chromium/Chrome not found. Set BRAVE_BIN or install Brave.");
        process.exit(2);
    }

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    console.log(`browser: ${browser_bin}`);
    console.log(`page:    ${url}`);

    const user_dir = fs.mkdtempSync(path.join(os.tmpdir(), "fengari-browser-"));
    const child = spawn(browser_bin, [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-allow-origins=*",
        `--user-data-dir=${user_dir}`,
        "--remote-debugging-port=0",
        "about:blank"
    ], {
        stdio: ["ignore", "ignore", "pipe"]
    });

    let browser_output = "";
    child.stderr.on("data", (chunk) => { browser_output += chunk.toString(); });

    let cdp = null;
    let exit_code = 0;
    try {
        const devtools_port = await wait_for_port(user_dir, 20000);
        let targets = await json(`http://127.0.0.1:${devtools_port}/json/list`);
        let target = targets.find((item) => item.type === "page");
        if (!target) {
            target = await json(
                `http://127.0.0.1:${devtools_port}/json/new?about:blank`,
                { method: "PUT" }
            );
        }

        cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.connect();
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");

        const loaded = cdp.once("Page.loadEventFired");
        await cdp.send("Page.navigate", { url: url });
        await loaded;

        const ready = await cdp.evaluate("typeof window.fengari !== 'undefined'");
        if (!ready)
            throw new Error("the bundle did not expose window.fengari");

        const results = await cdp.evaluate(PAGE_TESTS);
        let failed = 0;
        for (const result of results) {
            if (result.ok) {
                console.log(`ok   ${result.name}`);
            } else {
                failed++;
                console.log(`FAIL ${result.name}`);
                console.log("  " + result.error.replace(/\n/g, "\n  "));
            }
        }
        console.log("");
        if (failed > 0) {
            console.log(`${failed}/${results.length} browser tests failed`);
            exit_code = 1;
        } else {
            console.log(`${results.length} browser tests passed`);
        }
    } catch (e) {
        console.error("browser test error:", e.message);
        if (browser_output)
            console.error(browser_output.split("\n").slice(-20).join("\n"));
        exit_code = 1;
    } finally {
        if (cdp) {
            try { await cdp.send("Browser.close"); } catch (e) { /* ignore */ }
            cdp.close();
        }
        child.kill("SIGKILL");
        server.close();
        if (!keep) {
            try { fs.rmSync(user_dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        } else {
            console.log(`user data dir: ${user_dir}`);
        }
    }
    process.exit(exit_code);
};

main();
