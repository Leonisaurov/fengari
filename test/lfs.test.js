"use strict";

const lua     = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib  = require('../src/lualib.js');
const lfs     = require('../src/lfs.js');
const { api } = require('../src/fengari.js');
const { to_luastring } = require("../src/fengaricore.js");

const vfs = lfs.vfs;

let output = [];
let errors = [];

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

const decode = function(bytes) {
    return bytes === null ? null : lfs.to_jsstring(bytes);
};

beforeAll(() => {
    vfs.useMemory();
    vfs.setStdout((line) => output.push(line));
    vfs.setStderr((line) => errors.push(line));
});

beforeEach(() => {
    vfs.reset();
    output = [];
    errors = [];
});

afterAll(() => {
    vfs.useNode();
    vfs.reset();
});

test('the memory backend can be selected and reports its name', () => {
    expect(vfs.current()).toBe("memory");
    vfs.useMemory();
    expect(vfs.current()).toBe("memory");
    expect(lfs.is_node).toBe(true);  /* tests themselves run under Node */
});

test('io works entirely in memory', () => {
    run(`
        local f = assert(io.open("/memory.txt", "w"))
        assert(f:write("hello\\n", 42, "\\n"))
        assert(f:close())

        f = assert(io.open("/memory.txt", "r"))
        assert(f:read("l") == "hello")
        assert(f:read("n") == 42)
        assert(f:seek("set") == 0)
        assert(f:read("a") == "hello\\n42\\n")
        assert(f:seek("end") == 9)
        assert(f:close())

        local lines = {}
        for line in io.lines("/memory.txt") do lines[#lines+1] = line end
        assert(table.concat(lines, "|") == "hello|42")
    `);

    expect(decode(vfs.readFile("/memory.txt"))).toBe("hello\n42\n");
    expect(vfs.listFiles()).toContain("/memory.txt");
});

test('mounted files are visible to Lua', () => {
    vfs.mount("/assets/data.txt", "from the host\n");
    vfs.mount("/assets/latin1.txt", Uint8Array.from([0x61, 0xff, 0x62]));

    run(`
        local f = assert(io.open("/assets/data.txt", "r"))
        assert(f:read("l") == "from the host")
        f:close()

        f = assert(io.open("/assets/latin1.txt", "r"))
        local data = f:read("a")
        assert(#data == 3)
        assert(data:byte(2) == 255)
        f:close()
    `);

    expect(vfs.readFile("/assets/missing.txt")).toBe(null);
});

test('files created by Lua can be read by the host', () => {
    run(`
        local f = assert(io.open("relative.txt", "w"))
        f:write("relative to the root")
        f:close()
    `);

    /* relative paths resolve against the virtual root */
    expect(decode(vfs.readFile("/relative.txt"))).toBe("relative to the root");
});

test('snapshot and restore round trip', () => {
    vfs.mount("/keep.txt", "keep me");
    vfs.mount("/dir/other.txt", Uint8Array.from([1, 2, 3]));

    let snapshot = vfs.snapshot();
    expect(snapshot.length).toBe(2);

    vfs.reset();
    expect(vfs.listFiles()).toEqual([]);

    vfs.restore(snapshot);
    expect(decode(vfs.readFile("/keep.txt"))).toBe("keep me");
    expect(Array.from(vfs.readFile("/dir/other.txt"))).toEqual([1, 2, 3]);
    expect(vfs.unmount("/keep.txt")).toBe(true);
    expect(vfs.readFile("/keep.txt")).toBe(null);
});

test('io.tmpfile uses the memory file system', () => {
    run(`
        local f = assert(io.tmpfile())
        assert(f:write("temporary"))
        assert(f:seek("set") == 0)
        assert(f:read("a") == "temporary")
        assert(f:close())
    `);

    expect(vfs.listFiles()).toEqual([]);  /* removed when closed */
});

test('stdin, stdout and stderr are host controlled', () => {
    vfs.setStdin("first\nsecond\n");

    run(`
        assert(io.read("l") == "first")
        assert(io.input():read("l") == "second")
        assert(io.read("l") == nil)

        io.write("partial")
        io.write(" line\\n")
        io.stderr:write("problem\\n")
    `);

    expect(output).toEqual(["partial line"]);
    expect(errors).toEqual(["problem"]);

    run(`io.write("pending") io.flush()`);
    expect(output).toEqual(["partial line", "pending"]);
});

test('unflushed output stays buffered until flush', () => {
    run(`
        io.write("x")
        io.write("y")
    `);
    expect(output).toEqual([]);
    run(`io.flush()`);
    expect(output).toEqual(["xy"]);
});

test('opening a missing file reports ENOENT', () => {
    run(`
        local f, message, errno = io.open("/nope.txt")
        assert(f == nil)
        assert(message:match("no such file"))
        assert(errno ~= 0)
    `);
});

test('reading a write-only handle fails', () => {
    run(`
        local f = assert(io.open("/write-only.txt", "w"))
        assert(f:write("data"))
        local ok, result, message = pcall(f.read, f, "a")
        assert(ok)
        assert(result == nil)
        assert(message:match("bad file descriptor"))
        f:close()
    `);
});

test('os file functions work on the memory file system', () => {
    vfs.mount("/old.txt", "content");

    run(`
        assert(os.rename("/old.txt", "/new.txt"))
        assert(io.open("/old.txt") == nil)
        local f = assert(io.open("/new.txt", "r"))
        assert(f:read("a") == "content")
        f:close()
        assert(os.remove("/new.txt"))
        assert(io.open("/new.txt") == nil)

        local missing, message, errno = os.remove("/missing.txt")
        assert(missing == nil)
        assert(type(message) == "string")
        assert(errno ~= 0)

        local name = os.tmpname()
        assert(type(name) == "string" and #name > 0)
        local tmp = assert(io.open(name, "w"))
        assert(tmp:write("x"))
        tmp:close()
        assert(os.remove(name))
    `);

    expect(vfs.listFiles()).toEqual([]);
});

test('os.getenv reads the host environment', () => {
    vfs.setEnv("LUA_HOME", "/lua");
    vfs.setEnv("EMPTY", "");

    run(`
        assert(os.getenv("LUA_HOME") == "/lua")
        assert(os.getenv("EMPTY") == "")
        assert(os.getenv("NOT_SET") == nil)
    `);
});

test('os.execute fails cleanly without a process API', () => {
    run(`
        local ok, what, code = os.execute("echo hi")
        assert(ok == nil)
        assert(type(what) == "string")
        assert(what:match("not available"))
        assert(code ~= 0)
        assert(os.execute() == false)
    `);
});

test('os.exit raises an error instead of leaving the page', () => {
    run(`
        local ok, err = pcall(os.exit, 0)
        assert(not ok)
        assert(err:match("not available"))
    `);
});

test('io.popen reports that it is unsupported', () => {
    run(`
        local ok, err = pcall(io.popen, "true")
        assert(not ok)
        assert(err:match("not supported"))
    `);
});

test('os.clock still works', () => {
    run(`
        local a = os.clock()
        assert(type(a) == "number")
        assert(a >= 0)
    `);
});

test('vfs persists snapshots through localStorage', () => {
    const store = new Map();
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key) => store.has(key) ? store.get(key) : null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key)
        }
    });

    try {
        vfs.mount("/persist/a.txt", "alpha");
        vfs.mount("/persist/b.bin", Uint8Array.from([0, 1, 255]));
        expect(vfs.saveToStorage("fengari-test")).toBe(2);

        vfs.reset();
        expect(vfs.readFile("/persist/a.txt")).toBe(null);

        expect(vfs.loadFromStorage("fengari-test")).toBe(2);
        expect(decode(vfs.readFile("/persist/a.txt"))).toBe("alpha");
        expect(Array.from(vfs.readFile("/persist/b.bin"))).toEqual([0, 1, 255]);

        vfs.clearStorage("fengari-test");
        expect(vfs.loadFromStorage("fengari-test")).toBe(0);
    } finally {
        if (previous)
            Object.defineProperty(globalThis, "localStorage", previous);
        else
            delete globalThis.localStorage;
    }
});

test('IndexedDB helpers report when the API is unavailable', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: undefined
    });
    try {
        await expect(vfs.saveToIndexedDB("fengari-test")).rejects.toThrow(/not available/);
        await expect(vfs.loadFromIndexedDB("fengari-test")).rejects.toThrow(/not available/);
        await expect(vfs.clearFromIndexedDB("fengari-test")).rejects.toThrow(/not available/);
    } finally {
        if (previous)
            Object.defineProperty(globalThis, "indexedDB", previous);
        else
            delete globalThis.indexedDB;
    }
});

test('vfs.loadFromURL fetches and mounts a resource', async () => {
    vfs.reset();
    const size = await vfs.loadFromURL("data:text/plain,hello%20url", "/from-url.txt");
    expect(size).toBe(9);
    expect(decode(vfs.readFile("/from-url.txt"))).toBe("hello url");
    await expect(vfs.loadFromURL("data:text/plain,", "/empty.txt")).resolves.toBe(0);
});

test('IndexedDB persistence round trips with an IndexedDB-like API', async () => {
    const data = new Map();
    const store = {
        put: (value, key) => { data.set(key, value); return {}; },
        get: (key) => ({ result: data.get(key) }),
        delete: (key) => { data.delete(key); return {}; }
    };
    const db = {
        createObjectStore: () => store,
        close: () => {},
        transaction: () => {
            const tx = { objectStore: () => store };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
        }
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: {
            open: () => {
                const request = {};
                setTimeout(() => {
                    request.result = db;
                    if (request.onupgradeneeded) request.onupgradeneeded();
                    if (request.onsuccess) request.onsuccess();
                }, 0);
                return request;
            }
        }
    });

    try {
        vfs.reset();
        vfs.mount("/idb.txt", "idb-data");
        expect(await vfs.saveToIndexedDB("cdp")).toBe(1);
        vfs.reset();
        expect(await vfs.loadFromIndexedDB("cdp")).toBe(1);
        expect(decode(vfs.readFile("/idb.txt"))).toBe("idb-data");
        await vfs.clearFromIndexedDB("cdp");
        expect(await vfs.loadFromIndexedDB("cdp")).toBe(0);
    } finally {
        if (previous)
            Object.defineProperty(globalThis, "indexedDB", previous);
        else
            delete globalThis.indexedDB;
    }
});

const make_access = function(initial) {
    let data = Uint8Array.from(initial || [], (c) => typeof c === "string" ? c.charCodeAt(0) : c);
    return {
        read: (buffer, options) => {
            const at = options.at || 0;
            const n = Math.min(buffer.length, Math.max(0, data.length - at));
            buffer.set(data.subarray(at, at + n));
            return n;
        },
        write: (buffer, options) => {
            const at = options.at || 0;
            const end = at + buffer.length;
            if (end > data.length) {
                const grown = new Uint8Array(end);
                grown.set(data);
                data = grown;
            }
            data.set(buffer, at);
            return buffer.length;
        },
        getSize: () => data.length,
        truncate: (size) => {
            const next = new Uint8Array(size);
            next.set(data.subarray(0, Math.min(size, data.length)));
            data = next;
        },
        flush: () => {},
        close: () => {},
        text: () => Buffer.from(data).toString()
    };
};

const make_file = function(access) {
    return {
        kind: "file",
        access: access,
        createSyncAccessHandle: async () => access,
        createWritable: async () => ({
            write: async (text) => {
                const bytes = Uint8Array.from(String(text), (c) => c.charCodeAt(0));
                access.truncate(0);
                access.write(bytes, { at: 0 });
            },
            close: async () => {}
        }),
        getFile: async () => ({
            text: async () => access.text()
        })
    };
};

const make_dir = function() {
    const files = new Map();
    const dirs = new Map();
    const directory = {
        kind: "directory",
        files: files,
        dirs: dirs,
        getFileHandle: async (name, options) => {
            if (!files.has(name)) {
                if (!(options && options.create)) {
                    const error = new Error("NotFound");
                    error.name = "NotFoundError";
                    throw error;
                }
                files.set(name, make_file(make_access([])));
            }
            return files.get(name);
        },
        getDirectoryHandle: async (name, options) => {
            if (!dirs.has(name)) {
                if (!(options && options.create)) {
                    const error = new Error("NotFound");
                    error.name = "NotFoundError";
                    throw error;
                }
                dirs.set(name, make_dir());
            }
            return dirs.get(name);
        },
        entries: async function*() {
            for (const [name, handle] of files)
                yield [name, handle];
            for (const [name, handle] of dirs)
                yield [name, handle];
        },
        removeEntry: async (name) => {
            if (files.delete(name))
                return;
            if (dirs.delete(name))
                return;
            const error = new Error("NotFound");
            error.name = "NotFoundError";
            throw error;
        }
    };
    return directory;
};

test('direct OPFS mount reads, writes and pre-creates nested files', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "FileSystemSyncAccessHandle");
    Object.defineProperty(globalThis, "FileSystemSyncAccessHandle", {
        configurable: true,
        value: function FileSystemSyncAccessHandle() {}
    });

    try {
        const root = make_dir();
        const seed = make_access("seed");
        root.files.set("worker.txt", make_file(seed));
        const sub = make_dir();
        root.dirs.set("sub", sub);
        sub.files.set("chunk.lua", make_file(make_access("return 42")));

        expect(await vfs.mountOPFS(root, { files: ["nested/new.txt"] })).toBe(3);
        expect(vfs.current()).toBe("opfs");

        const state = api.createState();
        try {
            const out = state.run(
                'local f = assert(io.open("/sub/chunk.lua", "r"))' +
                ' local chunk = f:read("a") f:close()' +
                ' local n = assert(io.open("/worker.txt", "a")) n:write("more") n:close()' +
                ' local w = assert(io.open("/nested/new.txt", "w")) w:write("created") w:close()' +
                ' local ok, msg = os.remove("/worker.txt")' +
                ' assert(ok == nil and type(msg) == "string")' +
                ' return chunk'
            );
            expect(out).toBe("return 42");
        } finally {
            state.close();
        }

        const loaded = lfs.loadfile(to_luastring("/sub/chunk.lua"));
        expect(Buffer.from(loaded).toString()).toBe("return 42");

        expect(seed.text()).toBe("seedmore");
        expect(root.dirs.get("nested").files.get("new.txt").access.text()).toBe("created");

        expect(vfs.unmountOPFS()).toBe(true);
        expect(vfs.current()).toBe("memory");
        expect(vfs.unmountOPFS()).toBe(false);
    } finally {
        if (previous)
            Object.defineProperty(globalThis, "FileSystemSyncAccessHandle", previous);
        else
            delete globalThis.FileSystemSyncAccessHandle;
    }
});

test('mountOPFS validates its directory and worker capability', async () => {
    await expect(vfs.mountOPFS(null)).rejects.toThrow(/DirectoryHandle/);
    const root = make_dir();
    await expect(vfs.mountOPFS(root)).rejects.toThrow(/worker/);
});


test('OPFS snapshot helpers round trip with a directory handle', async () => {
    const root = make_dir();
    vfs.reset();
    vfs.mount("/snap.txt", "snapshot-data");
    expect(await vfs.saveToOPFS(root, "snap")).toBe(1);

    vfs.reset();
    expect(await vfs.loadFromOPFS(root, "snap")).toBe(1);
    expect(decode(vfs.readFile("/snap.txt"))).toBe("snapshot-data");

    await vfs.clearFromOPFS(root, "snap");
    expect(await vfs.loadFromOPFS(root, "snap")).toBe(0);
    await vfs.clearFromOPFS(root, "missing");

    await expect(vfs.saveToOPFS(null, "x")).rejects.toThrow(/DirectoryHandle/);
    await expect(vfs.loadFromOPFS(null, "x")).rejects.toThrow(/DirectoryHandle/);
    await expect(vfs.clearFromOPFS(null, "x")).rejects.toThrow(/DirectoryHandle/);
});
