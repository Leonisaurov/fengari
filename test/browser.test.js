"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

/*
** Run a child Node process with `process` removed before fengari is loaded.
** That selects the same branches a browser takes (in-memory VFS, no process
** API, console output) and exercises the whole io/os surface there.
*/
const run_without_process = function(code) {
    return execFileSync(process.execPath, ["-e", code], {
        encoding: "utf8",
        timeout: 30000
    });
};

test('io and os work on the in-memory file system without process', () => {
    let entry = path.join(__dirname, "..", "src", "fengari.js");
    let code = `
        Object.defineProperty(globalThis, "process", { value: undefined, configurable: true });

        const { lua, lauxlib, lualib, to_luastring, to_jsstring, vfs } = require(${JSON.stringify(entry)});
        const lines = [];
        vfs.mount("/mounted.txt", "host content\\n");
        vfs.mount("/module.lua", "return { answer = 42 }");
        vfs.mount("/chunk.lua", "return 'loaded from vfs'");
        vfs.mount("/jsmodule.js", "return { luaopen_jsmodule: function(L) { fengari.lua.lua_pushinteger(L, 99); return 1; } };");
        vfs.setStdout((line) => lines.push("out:" + line));
        vfs.setStderr((line) => lines.push("err:" + line));
        vfs.setStdin("stdin line\\n");
        vfs.setEnv("HOME", "/home/lua");

        const L = lauxlib.luaL_newstate();
        if (!L) throw new Error("no state");
        lualib.luaL_openlibs(L);

        const source = \`
            assert(io.read("l") == "stdin line")
            local f = assert(io.open("/mounted.txt", "r"))
            assert(f:read("l") == "host content")
            f:close()

            f = assert(io.open("/written.txt", "w"))
            f:write("from lua\\\\n")
            f:close()

            local lines = {}
            for line in io.lines("/written.txt") do lines[#lines+1] = line end
            assert(lines[1] == "from lua")

            assert(os.getenv("HOME") == "/home/lua")
            assert(os.rename("/written.txt", "/renamed.txt"))
            assert(os.remove("/renamed.txt"))

            package.path = "/?.lua"
            assert(require("module").answer == 42)
            assert(dofile("/chunk.lua") == "loaded from vfs")

            package.jspath = "/?.js"
            assert(require("jsmodule") == 99)

            local ok, err = pcall(io.popen, "true")
            assert(not ok and err:match("not supported"))
            ok, err = pcall(os.exit, 0)
            assert(not ok and err:match("not available"))
            local res, message, errno = os.execute("true")
            assert(res == nil and type(message) == "string" and errno ~= 0)
            assert(os.execute() == false)

            io.write("written by io\\\\n")
            io.stderr:write("written by stderr\\\\n")
        \`;

        const status = lauxlib.luaL_dostring(L, to_luastring(source));
        if (status !== 0) {
            let message = lua.lua_tostring(L, -1);
            throw new Error(message === null ? "lua failed" : to_jsstring(message));
        }

        console.log(lines.join("|"));
        console.log("files:" + vfs.listFiles().join(","));
    `;

    let out = run_without_process(code);
    expect(out).toContain("out:written by io");
    expect(out).toContain("err:written by stderr");
    expect(out).toContain("files:/chunk.lua,/jsmodule.js,/module.lua,/mounted.txt");
});

test('a bundler-style process shim does not select the Node backends', () => {
    let entry = path.join(__dirname, "..", "src", "fengari.js");
    let code = `
        /* Some bundlers inject a partial process object without versions. */
        globalThis.process = { env: {}, browser: true };

        const { lua, lauxlib, lualib, to_luastring, to_jsstring, vfs } = require(${JSON.stringify(entry)});
        const lines = [];
        vfs.mount("/shim.txt", "shim content");
        vfs.setStdout((line) => lines.push(line));

        const L = lauxlib.luaL_newstate();
        if (!L) throw new Error("no state");
        lualib.luaL_openlibs(L);

        const source = \`
            local f = assert(io.open("/shim.txt", "r"))
            assert(f:read("a") == "shim content")
            f:close()
            local w = assert(io.open("/shim-out.txt", "w"))
            w:write("ok")
            w:close()
            assert(os.remove("/shim-out.txt"))
            assert(os.execute() == false)
            io.write("shim output\\\\n")
        \`;

        const status = lauxlib.luaL_dostring(L, to_luastring(source));
        if (status !== 0) {
            let message = lua.lua_tostring(L, -1);
            throw new Error(message === null ? "lua failed" : to_jsstring(message));
        }
        console.log(lines.join("|"));
    `;

    let out = run_without_process(code);
    expect(out).toContain("shim output");
});
