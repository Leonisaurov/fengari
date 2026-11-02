"use strict";

const fs      = require('fs');
const os      = require('os');
const path    = require('path');

const lua     = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib  = require('../src/lualib.js');
const { to_luastring } = require("../src/fengaricore.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fengari-io-"));

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const file = function(name) {
    return path.join(dir, name);
};

/* Lua literal holding a path */
const lit = function(p) {
    return JSON.stringify(p);
};

const run = function(luaCode) {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");
    lualib.luaL_openlibs(L);
    let status = lauxlib.luaL_loadstring(L, to_luastring(luaCode));
    if (status === lua.LUA_OK)
        status = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
    if (status !== lua.LUA_OK)
        throw new Error(lua.lua_tojsstring(L, -1));
    return L;
};

const writeFile = function(name, contents) {
    fs.writeFileSync(file(name), contents);
};

const readFile = function(name) {
    return fs.readFileSync(file(name), "utf8");
};

/* ---------------------------------------------------------------------- */

test('io exposes the Lua 5.3 surface', () => {
    run(`
        for _, name in ipairs{
            "close", "flush", "input", "lines", "open", "output",
            "popen", "read", "tmpfile", "type", "write",
            "stdin", "stdout", "stderr"
        } do
            assert(io[name] ~= nil, "missing io." .. name)
        end

        local f = assert(io.tmpfile())
        for _, name in ipairs{
            "close", "flush", "lines", "read", "seek", "setvbuf", "write"
        } do
            assert(f[name] ~= nil, "missing file method " .. name)
        end
        assert(tostring(f):match("^file %("))
        assert(f:close())
    `);
});

test('io.open, write and the read formats', () => {
    let p = file("formats.txt");
    writeFile("formats.txt", "10 20\n30\nabc");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:read("n") == 10)
        assert(f:read("n") == 20)
        assert(f:read("l") == "")
        assert(f:read("L") == "30\\n")
        assert(f:read("l") == "abc")
        assert(f:read("l") == nil)
        assert(f:read("a") == "")
        assert(f:close())

        f = assert(io.open(${lit(p)}, "r"))
        assert(f:read(2) == "10")
        assert(f:read(0) == "")
        assert(f:read(100) == " 20\\n30\\nabc")
        assert(f:read(1) == nil)
        assert(f:read(0) == nil)
        assert(f:close())
    `);
});

test('io.open with a write mode creates the file', () => {
    let p = file("written.txt");

    run(`
        local f = assert(io.open(${lit(p)}, "w"))
        assert(f:write("hello ", 1, " ", 2.5) == f)
        assert(f:write() == f)
        assert(f:close())
    `);

    expect(readFile("written.txt")).toBe("hello 1 2.5");
});

test('file:seek with set, cur and end', () => {
    let p = file("seek.txt");
    writeFile("seek.txt", "0123456789");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:seek() == 0)
        assert(f:seek("cur") == 0)
        assert(f:seek("set", 4) == 4)
        assert(f:read(1) == "4")
        assert(f:seek("cur") == 5)
        assert(f:seek("cur", -2) == 3)
        assert(f:read("a") == "3456789")
        assert(f:seek("end") == 10)
        assert(f:seek("end", -2) == 8)
        assert(f:read("a") == "89")
        assert(f:seek("set", 0) == 0)
        assert(f:close())
    `);
});

test('read ahead does not break the logical position', () => {
    let p = file("lookahead.txt");
    writeFile("lookahead.txt", "42 rest\nnext");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:read("n") == 42)
        assert(f:seek("cur") == 2)
        assert(f:read("l") == " rest")
        assert(f:read("l") == "next")
        assert(f:read("l") == nil)
        assert(f:close())
    `);
});

test('r+ writes at the current position and a appends', () => {
    let p = file("rw.txt");
    writeFile("rw.txt", "abcdef");

    run(`
        local f = assert(io.open(${lit(p)}, "r+"))
        assert(f:seek("set", 2))
        assert(f:write("XY") == f)
        assert(f:close())
    `);
    expect(readFile("rw.txt")).toBe("abXYef");

    run(`
        local f = assert(io.open(${lit(p)}, "a"))
        assert(f:write("!"))
        assert(f:close())
    `);
    expect(readFile("rw.txt")).toBe("abXYef!");

    run(`
        local f = assert(io.open(${lit(p)}, "a+"))
        assert(f:read("a") == "abXYef!")
        assert(f:write("?"))
        assert(f:seek("end") == 8)
        assert(f:close())
    `);
    expect(readFile("rw.txt")).toBe("abXYef!?");
});

test('binary modes are accepted', () => {
    let p = file("binary.bin");

    run(`
        local f = assert(io.open(${lit(p)}, "wb"))
        f:write("\\0\\1\\2\\255")
        assert(f:close())

        f = assert(io.open(${lit(p)}, "rb"))
        local data = f:read("a")
        assert(#data == 4)
        assert(data:byte(1) == 0)
        assert(data:byte(4) == 255)
        assert(f:close())
    `);
});

test('file:lines and io.lines', () => {
    let p = file("lines.txt");
    writeFile("lines.txt", "one\ntwo\nthree\n");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        local lines = {}
        for line in f:lines() do lines[#lines+1] = line end
        assert(table.concat(lines, ",") == "one,two,three")
        assert(io.type(f) == "file")  -- f:lines does not close the file
        f:close()

        lines = {}
        for line in io.lines(${lit(p)}) do lines[#lines+1] = line end
        assert(table.concat(lines, ",") == "one,two,three")

        local with_eol = {}
        for line in io.lines(${lit(p)}, "L") do with_eol[#with_eol+1] = line end
        assert(table.concat(with_eol, "|") == "one\\n|two\\n|three\\n")
    `);
});

test('file:lines supports read formats', () => {
    let p = file("numbers.txt");
    writeFile("numbers.txt", "1 2\n3 4\n");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        local pairs = {}
        for a, b in f:lines("n", "n") do pairs[#pairs+1] = a + b end
        assert(table.concat(pairs, ",") == "3,7")
        f:close()
    `);
});

test('io.lines uses io.input when no file is given', () => {
    let p = file("default-input.txt");
    writeFile("default-input.txt", "a\nb\n");

    run(`
        assert(io.input(${lit(p)}))
        assert(io.read("l") == "a")
        assert(io.input():read("l") == "b")
        assert(io.input(io.stdin))
    `);
});

test('io.input and io.output switch the default handles', () => {
    let p = file("defaults.txt");
    let out = file("defaults-out.txt");
    writeFile("defaults.txt", "default input\n");

    run(`
        local input = assert(io.input(${lit(p)}))
        assert(io.input() == input)

        local output = assert(io.output(${lit(out)}))
        assert(io.output() == output)
        assert(io.write("from ", 1))  -- returns the default output file
        assert(io.close())
        assert(io.output(io.stdout))
    `);

    expect(readFile("defaults-out.txt")).toBe("from 1");

    run(`
        assert(io.input(${lit(p)}) ~= nil)
        assert(io.output(${lit(out)}) ~= nil)
        assert(io.close())
        assert(io.output(io.stdout))
        assert(io.input(io.stdin))
    `);
});

test('io.tmpfile creates a readable and writable file', () => {
    run(`
        local f = assert(io.tmpfile())
        assert(io.type(f) == "file")
        assert(f:write("temporary"))
        assert(f:seek("set") == 0)
        assert(f:read("a") == "temporary")
        assert(f:close())
        assert(io.type(f) == "closed file")
    `);
});

test('io.type and tostring', () => {
    run(`
        assert(io.type(io.stdout) == "file")
        assert(io.type(42) == nil)
        assert(io.type(nil) == nil)
        local f = assert(io.tmpfile())
        assert(tostring(f):match("^file %("))
        f:close()
        assert(tostring(f) == "file (closed)")
        assert(io.type(f) == "closed file")
    `);
});

test('f:setvbuf controls write buffering', () => {
    let p = file("vbuf.txt");

    run(`
        local f = assert(io.open(${lit(p)}, "w"))
        assert(f:setvbuf("full", 1024))
        assert(f:write("abc"))
        local r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "")  -- still buffered
        r:close()
        assert(f:flush())
        r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "abc")
        r:close()
        assert(f:write("def"))     -- buffered again (below the size)
        assert(f:close())          -- flushes on close
        r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "abcdef")
        r:close()
    `);

    run(`
        local f = assert(io.open(${lit(p)}, "w"))
        assert(f:setvbuf("line"))
        assert(f:write("a\\n"))    -- whole line, flushed
        local r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "a\\n")
        r:close()
        assert(f:write("b"))       -- no newline, buffered
        r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "a\\n")
        r:close()
        assert(f:flush())
        r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "a\\nb")
        r:close()
        f:close()
    `);

    run(`
        local f = assert(io.open(${lit(p)}, "w"))
        assert(f:setvbuf("full", 4))
        assert(f:write("ab"))
        local r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "")
        r:close()
        assert(f:write("cd"))      -- reaches the buffer size
        r = assert(io.open(${lit(p)}, "r"))
        assert(r:read("a") == "abcd")
        r:close()
        f:close()
    `);
});

test('f:setvbuf and flush', () => {
    let p = file("buffered.txt");

    run(`
        local f = assert(io.open(${lit(p)}, "w"))
        assert(f:setvbuf("no"))
        assert(f:setvbuf("full", 1024))
        assert(f:setvbuf("line"))
        assert(f:flush())
        f:write("data")
        assert(f:flush())
        assert(f:close())
    `);

    expect(readFile("buffered.txt")).toBe("data");
});

test('open failures return nil, message and errno', () => {
    let missing = file("does-not-exist.txt");

    run(`
        local f, message, errno = io.open(${lit(missing)})
        assert(f == nil)
        assert(type(message) == "string")
        assert(math.type(errno) == "integer")
        assert(errno ~= 0)
    `);
});

test('io.open rejects invalid modes', () => {
    let p = file("mode.txt");

    run(`
        for _, mode in ipairs{"x", "", "r++", "rw", "rbb?", "br"} do
            local ok, err = pcall(io.open, ${lit(p)}, mode)
            assert(not ok, mode)
            assert(err:match("invalid mode"), err)
        end
    `);
});

test('closed files cannot be used', () => {
    let p = file("closed.txt");
    writeFile("closed.txt", "x");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:close())
        local ok, err = pcall(f.read, f)
        assert(not ok and err:match("closed file"), err)
        ok, err = pcall(f.write, f, "x")
        assert(not ok and err:match("closed file"), err)
        ok, err = pcall(f.seek, f)
        assert(not ok and err:match("closed file"), err)
        ok, err = pcall(f.close, f)
        assert(not ok and err:match("closed file"), err)
    `);
});

test('standard files cannot be closed', () => {
    run(`
        for _, f in ipairs{io.stdin, io.stdout, io.stderr} do
            local ok, err = f:close()
            assert(ok == nil)
            assert(err == "cannot close standard file")
        end
        local ok, err = io.close()
        assert(ok == nil and err == "cannot close standard file")
        assert(io.type(io.stdout) == "file")
    `);
});

test('seeking a non seekable stream fails', () => {
    run(`
        local pos, message, errno = io.stdout:seek()
        assert(pos == nil)
        assert(type(message) == "string")
        assert(errno ~= 0)
    `);
});

test('invalid read formats and counts are rejected', () => {
    let p = file("bad-format.txt");
    writeFile("bad-format.txt", "abc");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        local ok, err = pcall(f.read, f, "x")
        assert(not ok and err:match("invalid format"), err)
        ok, err = pcall(f.read, f, -1)
        assert(not ok and err:match("invalid count"), err)
        f:close()
    `);
});

test('long lines larger than the read block are handled', () => {
    let long = "x".repeat(20000);
    writeFile("long.txt", long + "\n" + long + "\n");

    run(`
        local f = assert(io.open(${lit(file("long.txt"))}, "r"))
        assert(#f:read("l") == 20000)
        assert(#f:read("L") == 20001)
        assert(f:read("l") == nil)
        assert(f:seek("set", 10000) == 10000)
        assert(#f:read("a") == 30002)
        f:close()
    `);

    run(`
        local f = assert(io.open(${lit(file("long.txt"))}, "r"))
        assert(#f:read("a") == 40002)
        f:close()
    `);
});

test('numbers are parsed like tonumber, leaving the rest unread', () => {
    let p = file("numbers-parse.txt");
    writeFile("numbers-parse.txt", "0x10 1.5e2 -3 +7 .5 1e 0x");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:read("n") == 16)
        assert(f:read("n") == 150)
        assert(f:read("n") == -3)
        assert(f:read("n") == 7)
        assert(f:read("n") == 0.5)
        assert(f:read("n") == nil)  -- '1e' is not a valid numeral
        assert(f:read("l") == " 0x")
        assert(f:close())
    `);
});

test('read number failure leaves the stream untouched', () => {
    let p = file("not-a-number.txt");
    writeFile("not-a-number.txt", "abc");

    run(`
        local f = assert(io.open(${lit(p)}, "r"))
        assert(f:read("n") == nil)
        assert(f:read("a") == "abc")
        f:close()
    `);
});

test('io.read with no arguments reads a line from the default input', () => {
    let p = file("default-read.txt");
    writeFile("default-read.txt", "line one\nline two\n");

    run(`
        assert(io.input(${lit(p)}))
        assert(io.read() == "line one")
        assert(io.read("*l") == "line two")
        assert(io.read() == nil)
        assert(io.input(io.stdin))
    `);
});

(process.platform === "win32" ? test.skip : test)('io.popen reads command output', () => {
    run(`
        local p = assert(io.popen("printf 'hi there\\\\n'"))
        assert(p:read("a") == "hi there\\n")
        local ok, what, code = p:close()
        assert(ok == true and what == "exit" and code == 0)
        assert(io.type(p) == "closed file")
    `);
});

(process.platform === "win32" ? test.skip : test)('io.popen buffers output larger than 1 MiB', () => {
    run(`
        local p = assert(io.popen("head -c 2000000 /dev/zero"))
        local data = p:read("a")
        assert(#data == 2000000)
        assert(p:close())
    `);
});

(process.platform === "win32" ? test.skip : test)('io.popen reports the exit status', () => {
    run(`
        local p = assert(io.popen("exit 3"))
        local ok, what, code = p:close()
        assert(ok == nil and what == "exit" and code == 3)
    `);
});

(process.platform === "win32" ? test.skip : test)('io.popen reports the terminating signal', () => {
    run(`
        local p = assert(io.popen("kill -9 $$"))
        local ok, what, code = p:close()
        assert(ok == nil and what == "signal" and code == 9)
    `);

    run(`
        local p = assert(io.popen("cat >/dev/null; kill -9 $$", "w"))
        assert(p:write("x"))
        local ok, what, code = p:close()
        assert(ok == nil and what == "signal" and code == 9)
    `);
});

(process.platform === "win32" ? test.skip : test)('io.popen write mode feeds the command', () => {
    let out = file("popen.txt");

    run(`
        local p = assert(io.popen("cat > ${out}", "w"))
        assert(p:write("through a pipe\\n"))
        local ok, what, code = p:close()
        assert(ok == true and what == "exit" and code == 0)
    `);

    expect(readFile("popen.txt")).toBe("through a pipe\n");
});

(process.platform === "win32" ? test.skip : test)('io.popen rejects invalid modes', () => {
    run(`
        for _, mode in ipairs{"rw", "r+", "", "b"} do
            local ok, err = pcall(io.popen, "true", mode)
            assert(not ok and err:match("invalid mode"), err)
        end
    `);
});
