"use strict";

/**
 * Synchronous platform layer for the standard library.
 *
 * Under Node it delegates to 'fs', 'tmp' and 'child_process'. Elsewhere
 * (browsers, workers, embedded engines) it provides an in-memory file system,
 * so 'io' and the file related functions of 'os' keep working. Browsers have
 * no synchronous access to persistent storage, so the memory file system is
 * the only option in the main thread; hosts can seed it before running Lua
 * and read/persist it afterwards through the helpers in 'vfs'.
 */

const { to_luastring } = require("./fengaricore.js");

const is_node = typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null;

const EMPTY = new Uint8Array(0);

const text_decoder = typeof TextDecoder === "function"
    ? new TextDecoder("utf-8")
    : null;

/* decode bytes as UTF-8, replacing invalid sequences instead of throwing */
const to_jsstring = function(bytes) {
    if (text_decoder !== null)
        return text_decoder.decode(bytes);
    let s = "";
    for (let i = 0; i < bytes.length; i++)
        s += String.fromCharCode(bytes[i]);
    return s;
};

/* lossless one byte -> one char mapping, used as file system key */
const bytes_to_key = function(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++)
        s += String.fromCharCode(bytes[i]);
    return s;
};

const key_to_bytes = function(key) {
    let out = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++)
        out[i] = key.charCodeAt(i);
    return out;
};

const path_key = function(path) {
    if (typeof path === "string")
        return bytes_to_key(to_luastring(path));
    return bytes_to_key(path);
};

const normalize_key = function(key) {
    let parts = key.split("/");
    let out = [];
    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (part === "" || part === ".")
            continue;
        if (part === "..") {
            if (out.length > 0)
                out.pop();
            continue;
        }
        out.push(part);
    }
    return "/" + out.join("/");
};

const resolve_key = function(path) {
    return normalize_key(path_key(path));
};

const file_error = function(code, errno, message, path) {
    let display = "";
    if (path !== undefined) {
        let bytes = typeof path === "string" ? to_luastring(path) : path;
        display = `, '${to_jsstring(bytes)}'`;
    }
    let e = new Error(`${code}: ${message}${display}`);
    e.code = code;
    e.errno = errno;
    return e;
};

const concat_bytes = function(parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++)
        total += parts[i].length;
    let out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
        out.set(parts[i], offset);
        offset += parts[i].length;
    }
    return out;
};

/* storage helpers: base64 when the platform has it, byte arrays otherwise */
const encode_bytes = function(bytes) {
    if (typeof btoa === "function") {
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk)
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        return btoa(binary);
    }
    return Array.from(bytes);
};

const decode_bytes = function(value) {
    if (Array.isArray(value))
        return Uint8Array.from(value);
    if (typeof atob !== "function")
        throw new Error("cannot decode stored file data");
    let binary = atob(value);
    let out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        out[i] = binary.charCodeAt(i);
    return out;
};

/* run a transaction against the 'fengari-vfs' IndexedDB database */
const with_indexeddb = function(mode, action) {
    return new Promise(function(resolve, reject) {
        if (typeof indexedDB === "undefined") {
            reject(new Error("indexedDB is not available"));
            return;
        }
        let request = indexedDB.open("fengari-vfs", 1);
        request.onupgradeneeded = function() {
            request.result.createObjectStore("files");
        };
        request.onerror = function() {
            reject(request.error || new Error("indexedDB open failed"));
        };
        request.onsuccess = function() {
            let db = request.result;
            let tx;
            try {
                tx = db.transaction("files", mode);
            } catch (e) {
                db.close();
                reject(e);
                return;
            }
            let result;
            try {
                result = action(tx.objectStore("files"));
            } catch (e) {
                db.close();
                reject(e);
                return;
            }
            tx.oncomplete = function() {
                db.close();
                resolve(result ? result.result : undefined);
            };
            tx.onerror = function() {
                db.close();
                reject(tx.error || new Error("indexedDB transaction failed"));
            };
            tx.onabort = function() {
                db.close();
                reject(tx.error || new Error("indexedDB transaction aborted"));
            };
        };
    });
};

/* ====================================================================== */
/* in memory backend                                                      */
/* ====================================================================== */

const create_memory_backend = function() {
    const files = new Map();
    let environment = Object.create(null);
    let counter = 0;

    let stdin = { data: EMPTY, pos: 0 };
    let stdout = { pending: EMPTY, handler: function(line) { console.log(line); } };
    let stderr = { pending: EMPTY, handler: function(line) { console.error(line); } };

    const memory_error = function(code, errno, message, path) {
        return file_error(code, errno, message, path);
    };

    const entry = function(data) {
        return { data: data, size: data.length };
    };

    const append_output = function(stream, bytes) {
        if (bytes.length === 0)
            return;
        let data = stream.pending.length === 0
            ? bytes
            : concat_bytes([stream.pending, bytes]);
        let start = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] === 10 /* '\n' */) {
                stream.handler(to_jsstring(data.subarray(start, i)));
                start = i + 1;
            }
        }
        stream.pending = start === 0 ? data : data.subarray(start);
    };

    const flush_output = function(stream) {
        if (stream.pending.length > 0) {
            stream.handler(to_jsstring(stream.pending));
            stream.pending = EMPTY;
        }
    };

    const handle = function(key, mode) {
        let plus = mode.indexOf("+") !== -1;
        let append = mode[0] === 'a';
        let readable = mode[0] === 'r' || plus;
        let writable = mode[0] !== 'r' || plus;
        return {
            key: key,
            read: function(buffer, offset, length, position) {
                if (!readable)
                    throw memory_error("EBADF", -9, "bad file descriptor", key);
                let entry = files.get(key);
                if (!entry)
                    throw memory_error("EBADF", -9, "bad file descriptor", key);
                let start = position === null ? 0 : position;
                if (start >= entry.size)
                    return 0;
                let n = Math.min(length, entry.size - start);
                buffer.set(entry.data.subarray(start, start + n), offset);
                return n;
            },
            write: function(buffer, offset, length, position) {
                if (!writable)
                    throw memory_error("EBADF", -9, "bad file descriptor", key);
                let entry = files.get(key);
                if (!entry)
                    throw memory_error("EBADF", -9, "bad file descriptor", key);
                let start = append ? entry.size : (position === null ? 0 : position);
                let end = start + length;
                let data = entry.data;
                if (end > data.length) {
                    let grown = new Uint8Array(Math.max(end, data.length * 2));
                    grown.set(data);
                    data = grown;
                    entry.data = data;
                }
                data.set(buffer.subarray(offset, offset + length), start);
                if (end > entry.size)
                    entry.size = end;
                return length;
            },
            size: function() {
                let entry = files.get(key);
                return entry ? entry.size : 0;
            },
            close: function() { /* nothing to release */ },
            sync: function() { }
        };
    };

    const stdin_handle = {
        read: function(buffer, offset, length) {
            let n = Math.max(0, Math.min(length, stdin.data.length - stdin.pos));
            buffer.set(stdin.data.subarray(stdin.pos, stdin.pos + n), offset);
            stdin.pos += n;
            return n;
        },
        write: function() {
            throw memory_error("EBADF", -9, "bad file descriptor", "stdin");
        },
        size: function() { return stdin.data.length; },
        close: function() { },
        sync: function() { }
    };

    const output_handle = function(stream, name) {
        return {
            read: function() {
                throw memory_error("EBADF", -9, "bad file descriptor", name);
            },
            write: function(buffer, offset, length) {
                append_output(stream, buffer.subarray(offset, offset + length));
                return length;
            },
            size: function() { return 0; },
            close: function() { },
            sync: function() { flush_output(stream); }
        };
    };

    const backend = {
        name: "memory",
        stdin: stdin_handle,
        stdout: output_handle(stdout, "stdout"),
        stderr: output_handle(stderr, "stderr"),

        open: function(path, mode) {
            let key = resolve_key(path);
            let existing = files.has(key);
            switch (mode[0]) {
                case 'r':
                    if (!existing)
                        throw memory_error("ENOENT", -2, "no such file or directory", path);
                    return handle(key, mode);
                case 'w':
                    files.set(key, entry(EMPTY));
                    return handle(key, mode);
                case 'a':
                    if (!existing)
                        files.set(key, entry(EMPTY));
                    return handle(key, mode);
                default:
                    throw memory_error("EINVAL", -22, "invalid mode", path);
            }
        },

        openTemp: function() {
            let name = backend.tmpname();
            let key = normalize_key(name);
            files.set(key, entry(EMPTY));
            return {
                handle: handle(key, "w+"),
                name: name,
                cleanup: function() { files.delete(key); }
            };
        },

        /* streams cannot be spawned in a browser */
        popen: null,

        unlink: function(path) {
            let key = resolve_key(path);
            if (!files.delete(key))
                throw memory_error("ENOENT", -2, "no such file or directory", path);
        },

        rename: function(from, to) {
            let from_key = resolve_key(from);
            let to_key = resolve_key(to);
            let item = files.get(from_key);
            if (!item)
                throw memory_error("ENOENT", -2, "no such file or directory", from);
            files.set(to_key, item);
            files.delete(from_key);
        },

        tmpname: function() {
            let name;
            do {
                counter++;
                name = "/tmp/lua_" + counter.toString(36) +
                    Math.floor(Math.random() * 0x100000000).toString(36);
            } while (files.has(normalize_key(name)));
            return name;
        },

        getenv: function(key) {
            return Object.prototype.hasOwnProperty.call(environment, key)
                ? environment[key]
                : null;
        },

        execute: function() {
            throw file_error("ENOSYS", -38, "os.execute is not available in this environment");
        },

        clock: function() {
            let now = typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : Date.now();
            return now / 1000;
        },

        loadfile: function(path) {
            let item = files.get(resolve_key(path));
            return item ? item.data.subarray(0, item.size) : null;
        }
    };

    backend.vfs = {
        mount: function(path, contents) {
            let key = resolve_key(path);
            let data;
            if (typeof contents === "string")
                data = to_luastring(contents);
            else
                data = Uint8Array.from(contents);
            files.set(key, entry(data));
        },
        unmount: function(path) {
            return files.delete(resolve_key(path));
        },
        readFile: function(path) {
            let item = files.get(resolve_key(path));
            return item ? Uint8Array.from(item.data.subarray(0, item.size)) : null;
        },
        listFiles: function() {
            let out = [];
            for (let key of files.keys())
                out.push(to_jsstring(key_to_bytes(key)));
            out.sort();
            return out;
        },
        snapshot: function() {
            let out = [];
            for (let [key, item] of files) {
                out.push({
                    path: to_jsstring(key_to_bytes(key)),
                    data: Uint8Array.from(item.data.subarray(0, item.size))
                });
            }
            return out;
        },
        restore: function(entries) {
            for (let i = 0; i < entries.length; i++)
                backend.vfs.mount(entries[i].path, entries[i].data);
        },
        reset: function() {
            files.clear();
            environment = Object.create(null);
            stdin = { data: EMPTY, pos: 0 };
            stdout.pending = EMPTY;
            stderr.pending = EMPTY;
        },
        setStdin: function(contents) {
            stdin.data = typeof contents === "string"
                ? to_luastring(contents)
                : Uint8Array.from(contents);
            stdin.pos = 0;
        },
        setStdout: function(handler) {
            let previous = stdout.handler;
            stdout.handler = handler || function(line) { console.log(line); };
            return previous;
        },
        setStderr: function(handler) {
            let previous = stderr.handler;
            stderr.handler = handler || function(line) { console.error(line); };
            return previous;
        },
        flush: function() {
            flush_output(stdout);
            flush_output(stderr);
        },
        setEnv: function(key, value) {
            environment[key] = String(value);
        },
        saveToStorage: function(key) {
            let storage = globalThis.localStorage;
            if (!storage)
                throw new Error("localStorage is not available");
            let entries = backend.vfs.snapshot().map(function(item) {
                return { path: item.path, data: encode_bytes(item.data) };
            });
            storage.setItem(key, JSON.stringify({ version: 1, files: entries }));
            return entries.length;
        },
        loadFromStorage: function(key) {
            let storage = globalThis.localStorage;
            if (!storage)
                throw new Error("localStorage is not available");
            let raw = storage.getItem(key);
            if (raw === null)
                return 0;
            let parsed = JSON.parse(raw);
            let entries = (parsed.files || []).map(function(item) {
                return { path: item.path, data: decode_bytes(item.data) };
            });
            backend.vfs.restore(entries);
            return entries.length;
        },
        clearStorage: function(key) {
            let storage = globalThis.localStorage;
            if (!storage)
                throw new Error("localStorage is not available");
            storage.removeItem(key);
        },
        saveToIndexedDB: function(key) {
            let entries = backend.vfs.snapshot().map(function(item) {
                return { path: item.path, data: encode_bytes(item.data) };
            });
            return with_indexeddb("readwrite", function(store) {
                store.put({ version: 1, files: entries }, key);
            }).then(function() {
                return entries.length;
            });
        },
        loadFromIndexedDB: function(key) {
            return with_indexeddb("readonly", function(store) {
                return store.get(key);
            }).then(function(parsed) {
                if (!parsed)
                    return 0;
                let entries = (parsed.files || []).map(function(item) {
                    return { path: item.path, data: decode_bytes(item.data) };
                });
                backend.vfs.restore(entries);
                return entries.length;
            });
        },
        clearFromIndexedDB: function(key) {
            return with_indexeddb("readwrite", function(store) {
                store.delete(key);
            });
        }
    };

    return backend;
};

/* ====================================================================== */
/* Node backend                                                           */
/* ====================================================================== */

const create_node_backend = function() {
    const fs = require('fs');
    const tmp = require('tmp');
    const child_process = require('child_process');

    const node_path = function(path) {
        if (typeof path === "string")
            return path;
        return Buffer.from(path.buffer, path.byteOffset, path.byteLength);
    };

    const handle = function(fd) {
        return {
            fd: fd,
            read: function(buffer, offset, length, position) {
                return fs.readSync(fd, buffer, offset, length, position);
            },
            write: function(buffer, offset, length, position) {
                return fs.writeSync(fd, buffer, offset, length, position);
            },
            size: function() {
                return fs.fstatSync(fd).size;
            },
            close: function() {
                fs.closeSync(fd);
            },
            sync: function() {
                fs.fsyncSync(fd);
            }
        };
    };

    const open_temp = function() {
        let info = tmp.fileSync({ postfix: ".tmp", discardDescriptor: true, mode: 0o600 });
        let fd;
        try {
            fd = fs.openSync(info.name, 'w+');
        } catch (e) {
            info.removeCallback();
            throw e;
        }
        return {
            handle: handle(fd),
            name: info.name,
            cleanup: function() { info.removeCallback(); }
        };
    };

    const backend = {
        name: "node",
        stdin: handle(process.stdin && process.stdin.fd !== undefined ? process.stdin.fd : 0),
        stdout: handle(process.stdout && process.stdout.fd !== undefined ? process.stdout.fd : 1),
        stderr: handle(process.stderr && process.stderr.fd !== undefined ? process.stderr.fd : 2),

        open: function(path, mode) {
            /* Node does not understand 'b' (binary is the default) */
            return handle(fs.openSync(node_path(path), mode.replace(/b/g, "")));
        },

        openTemp: open_temp,

        popen: function(command, mode) {
            command = to_jsstring(command);
            let info = open_temp();
            let finish = null;
            if (mode === 'r') {
                /* Lua is synchronous: run the command now and buffer stdout */
                let result = child_process.spawnSync(command, {
                    shell: true,
                    stdio: ['ignore', 'pipe', 'inherit'],
                    maxBuffer: Infinity
                });
                if (result.error) {
                    try { info.handle.close(); } catch (e) { /* ignore */ }
                    info.cleanup();
                    return { error: result.error };
                }
                let output = result.stdout || EMPTY;
                try {
                    if (output.length > 0)
                        info.handle.write(output, 0, output.length, 0);
                } catch (e) {
                    try { info.handle.close(); } catch (e2) { /* ignore */ }
                    info.cleanup();
                    return { error: e };
                }
                finish = function() {
                    try { info.handle.close(); } catch (e) { /* ignore */ }
                    info.cleanup();
                    if (result.signal)
                        return { signal: result.signal };
                    return { status: result.status };
                };
            } else {
                finish = function() {
                    let data;
                    try {
                        data = fs.readFileSync(info.name);
                    } catch (e) {
                        try { info.handle.close(); } catch (e2) { /* ignore */ }
                        info.cleanup();
                        return { error: e };
                    }
                    try { info.handle.close(); } catch (e) { /* ignore */ }
                    info.cleanup();
                    let result = child_process.spawnSync(command, {
                        shell: true,
                        input: data,
                        stdio: ['pipe', 'inherit', 'inherit']
                    });
                    if (result.error)
                        return { error: result.error };
                    if (result.signal)
                        return { signal: result.signal };
                    return { status: result.status };
                };
            }
            return {
                handle: info.handle,
                name: info.name,
                cleanup: info.cleanup,
                close: finish
            };
        },

        unlink: function(path) {
            try {
                fs.unlinkSync(node_path(path));
            } catch (e) {
                if (e.code === "EISDIR")
                    fs.rmdirSync(node_path(path));
                else
                    throw e;
            }
        },

        rename: function(from, to) {
            fs.renameSync(node_path(from), node_path(to));
        },

        tmpname: function() {
            return tmp.tmpNameSync();
        },

        getenv: function(key) {
            return Object.prototype.hasOwnProperty.call(process.env, key)
                ? process.env[key]
                : null;
        },

        execute: function(command) {
            child_process.execSync(command, {
                stdio: [process.stdin, process.stdout, process.stderr]
            });
        },

        clock: function() {
            return process.uptime();
        },

        loadfile: function() {
            return null;  /* Node reads through the real file system */
        }
    };

    return backend;
};

/* ====================================================================== */
/* public interface                                                       */
/* ====================================================================== */

const memory_backend = create_memory_backend();
const node_backend = is_node ? create_node_backend() : null;

let backend = node_backend !== null ? node_backend : memory_backend;

const active_backend = function() {
    return backend;
};

module.exports.is_node = is_node;
module.exports.backend_name = function() {
    return active_backend().name;
};
module.exports.supports_processes = function() {
    return active_backend().name === "node";
};
module.exports.EMPTY = EMPTY;
module.exports.to_jsstring = to_jsstring;
module.exports.path_to_string = function(path) {
    return typeof path === "string" ? path : to_jsstring(path);
};

module.exports.open = function(path, mode) {
    return active_backend().open(path, mode);
};
module.exports.openTemp = function() {
    return active_backend().openTemp();
};
module.exports.popen = function(command, mode) {
    return active_backend().popen === null ? null : active_backend().popen(command, mode);
};
module.exports.unlink = function(path) {
    return active_backend().unlink(path);
};
module.exports.rename = function(from, to) {
    return active_backend().rename(from, to);
};
module.exports.tmpname = function() {
    return active_backend().tmpname();
};
module.exports.getenv = function(key) {
    return active_backend().getenv(key);
};
module.exports.execute = function(command) {
    return active_backend().execute(command);
};
module.exports.clock = function() {
    return active_backend().clock();
};
module.exports.loadfile = function(path) {
    return active_backend().loadfile(path);
};
module.exports.stdin = function() {
    return active_backend().stdin;
};
module.exports.stdout = function() {
    return active_backend().stdout;
};
module.exports.stderr = function() {
    return active_backend().stderr;
};

/* host helpers for the in memory file system */
module.exports.vfs = Object.assign({}, memory_backend.vfs, {
    useMemory: function() {
        backend = memory_backend;
        return memory_backend;
    },
    useNode: function() {
        if (node_backend !== null)
            backend = node_backend;
        return backend;
    },
    current: function() {
        return backend.name;
    }
});
