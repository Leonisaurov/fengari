"use strict";

const lfs = require('./lfs.js');

const {
    LUA_MINSTACK,
    LUA_REGISTRYINDEX,
    LUA_TNUMBER,
    lua_getfield,
    lua_gettop,
    lua_isnone,
    lua_isnoneornil,
    lua_newuserdata,
    lua_pop,
    lua_pushboolean,
    lua_pushcclosure,
    lua_pushinteger,
    lua_pushliteral,
    lua_pushnil,
    lua_pushstring,
    lua_pushvalue,
    lua_replace,
    lua_rotate,
    lua_setfield,
    lua_settop,
    lua_stringtonumber,
    lua_toboolean,
    lua_tointeger,
    lua_tostring,
    lua_touserdata,
    lua_type,
    lua_upvalueindex
} = require('./lua.js');
const {
    LUA_FILEHANDLE,
    luaL_argerror,
    luaL_checkany,
    luaL_checkinteger,
    luaL_checklstring,
    luaL_checkoption,
    luaL_checkstack,
    luaL_checkstring,
    luaL_checkudata,
    luaL_error,
    luaL_execresult,
    luaL_fileresult,
    luaL_newlib,
    luaL_newmetatable,
    luaL_optinteger,
    luaL_optstring,
    luaL_setfuncs,
    luaL_setmetatable,
    luaL_testudata
} = require('./lauxlib.js');
const lualib = require('./lualib.js');
const { to_luastring } = require("./fengaricore.js");

const IO_PREFIX = "_IO_";
const IOPREF_LEN = IO_PREFIX.length;
const IO_INPUT = to_luastring(IO_PREFIX + "input");
const IO_OUTPUT = to_luastring(IO_PREFIX + "output");

/* size of the blocks read from a file at once */
const READ_CHUNK = 4096;
/* maximum length of a numeral accepted by 'read_number' (as in PUC Lua) */
const L_MAXLENNUM = 200;
/* maximum number of formats accepted by 'io.lines'/'f:lines' */
const MAXARGLINE = 250;

const EMPTY = new Uint8Array(0);

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

const ESPIPE = { code: "ESPIPE", errno: -29, message: "Illegal seek" };
const EINVAL = { code: "EINVAL", errno: -22, message: "Invalid argument" };

/**
 * A Lua file handle wraps a platform stream and keeps track of its own
 * position so that 'f:seek' works even though Node has no 'lseek'.
 *
 * 'pos' is the stream position (null for non-seekable streams); 'pushback'
 * holds bytes that have been read ahead but not consumed yet, so the logical
 * position of the stream is 'pos - pushback.length'.
 */
const LStream = function(handle, name, options) {
    options = options || {};
    this.handle = handle;
    this.name = name;
    this.pos = options.seekable === false ? null : 0;
    this.append = !!options.append;
    this.pushback = EMPTY;
    this.error = null;
    this.cleanup = options.cleanup || null;
    this.popen = options.popen || null;
    this.wbuf = EMPTY;       /* pending writes when buffering is enabled */
    this.vbuf = "no";        /* "no", "full" or "line" (setvbuf) */
    this.vbufsize = READ_CHUNK;
};
LStream.prototype.toString = function() {
    return this.name;
};

const logical_pos = function(f) {
    return f.pos === null ? null : f.pos - f.pushback.length;
};

const tolstream = function(L) {
    return luaL_checkudata(L, 1, LUA_FILEHANDLE);
};

const isclosed = function(p) {
    return p.closef === null;
};

/* validate a standard file handle taken from the registry */
const checkiofile = function(L, p, findex) {
    if (isclosed(p))
        luaL_error(L, to_luastring("standard %s file is closed"), findex.subarray(IOPREF_LEN));
    return p.f;
};

const io_type = function(L) {
    luaL_checkany(L, 1);
    let p = luaL_testudata(L, 1, LUA_FILEHANDLE);
    if (p === null)
        lua_pushnil(L);  /* not a file */
    else if (isclosed(p))
        lua_pushliteral(L, "closed file");
    else
        lua_pushliteral(L, "file");
    return 1;
};

const f_tostring = function(L) {
    let p = tolstream(L);
    if (isclosed(p))
        lua_pushliteral(L, "file (closed)");
    else
        lua_pushstring(L, to_luastring(`file (${p.f.toString()})`));
    return 1;
};

const tofile = function(L) {
    let p = tolstream(L);
    if (isclosed(p))
        luaL_error(L, to_luastring("attempt to use a closed file"));
    lualib.lua_assert(p.f);
    return p.f;
};

const newprefile = function(L) {
    let p = lua_newuserdata(L);
    p.f = null;
    p.closef = null;
    luaL_setmetatable(L, LUA_FILEHANDLE);
    return p;
};

const aux_close = function(L) {
    let p = tolstream(L);
    let cf = p.closef;
    p.closef = null;  /* mark stream as closed */
    return cf(L);
};

/* ---------------------------------------------------------------------- */
/* low level reads and writes                                             */
/* ---------------------------------------------------------------------- */

/* Node does not expose 'lseek'; read updates the tracked position instead */
const read_at = function(f, buffer, offset, length) {
    try {
        if (f.pos === null)
            return f.handle.read(buffer, offset, length, null);
        let n = f.handle.read(buffer, offset, length, f.pos);
        f.pos += n;
        return n;
    } catch (e) {
        f.error = e;
        return 0;
    }
};

const raw_write = function(f, buffer) {
    f.pushback = EMPTY;  /* a write invalidates any buffered read ahead */
    try {
        let written = 0;
        while (written < buffer.length) {
            let n;
            if (f.pos === null)
                n = f.handle.write(buffer, written, buffer.length - written, null);
            else if (f.append) {
                n = f.handle.write(buffer, written, buffer.length - written, null);
                f.pos = f.handle.size();
            } else {
                let position = f.pos;
                n = f.handle.write(buffer, written, buffer.length - written, position + written);
                f.pos = position + written + n;
            }
            if (n <= 0)
                return false;
            written += n;
        }
        return true;
    } catch (e) {
        f.error = e;
        return false;
    }
};

const write_at = function(f, buffer) {
    if (f.vbuf === "no")
        return raw_write(f, buffer);

    f.wbuf = f.wbuf.length === 0
        ? Uint8Array.from(buffer)
        : concat_bytes([f.wbuf, buffer]);

    if (f.vbuf === "line") {
        let index = -1;
        for (let i = f.wbuf.length - 1; i >= 0; i--) {
            if (f.wbuf[i] === 10 /* '\n' */) {
                index = i;
                break;
            }
        }
        if (index !== -1) {
            let pending = f.wbuf.subarray(0, index + 1);
            f.wbuf = f.wbuf.subarray(index + 1);
            return raw_write(f, pending);
        }
        return true;
    }

    /* "full": flush when the buffer reaches the configured size */
    if (f.wbuf.length >= f.vbufsize)
        return flush_write(f);
    return true;
};

/* write any pending output now */
const flush_write = function(f) {
    if (f.wbuf.length === 0)
        return true;
    let pending = f.wbuf;
    f.wbuf = EMPTY;
    return raw_write(f, pending);
};

/* make sure 'pushback' is not empty, reading a new block if needed */
const fill = function(f) {
    if (f.pushback.length > 0)
        return true;
    if (f.error)
        return false;
    let buffer = new Uint8Array(READ_CHUNK);
    let n = read_at(f, buffer, 0, READ_CHUNK);
    if (n === 0)
        return false;
    f.pushback = buffer.subarray(0, n);
    return true;
};

const read_byte = function(f) {
    if (!fill(f))
        return -1;
    let c = f.pushback[0];
    f.pushback = f.pushback.subarray(1);
    return c;
};

const unread_byte = function(f, c) {
    if (c < 0)
        return;
    let buffer = new Uint8Array(1);
    buffer[0] = c;
    f.pushback = concat_bytes([buffer, f.pushback]);
};

/* read the whole stream, appending blocks to 'parts' */
const read_blocks = function(f, parts) {
    if (f.pushback.length > 0) {
        parts.push(f.pushback);
        f.pushback = EMPTY;
    }
    while (!f.error) {
        let buffer = new Uint8Array(READ_CHUNK);
        let n = read_at(f, buffer, 0, READ_CHUNK);
        if (n === 0)
            break;
        parts.push(buffer.subarray(0, n));
    }
};

const push_bytes = function(L, bytes) {
    lua_pushstring(L, bytes);
};

const read_chars = function(L, f, n) {
    let parts = [];
    let remaining = n;
    if (f.pushback.length > 0) {
        let take = Math.min(remaining, f.pushback.length);
        parts.push(f.pushback.subarray(0, take));
        f.pushback = f.pushback.subarray(take);
        remaining -= take;
    }
    while (remaining > 0 && !f.error) {
        let size = Math.min(remaining, READ_CHUNK);
        let buffer = new Uint8Array(size);
        let got = read_at(f, buffer, 0, size);
        if (got === 0)
            break;
        parts.push(buffer.subarray(0, got));
        remaining -= got;
    }
    let result = concat_bytes(parts);
    push_bytes(L, result);
    return result.length > 0;  /* true iff read something */
};

const read_all = function(L, f) {
    let parts = [];
    read_blocks(f, parts);
    push_bytes(L, concat_bytes(parts));
};

const read_line = function(L, f, chop) {
    let parts = [];
    let found = false;
    while (fill(f)) {
        let index = f.pushback.indexOf(10 /* '\n' */);
        if (index === -1) {
            parts.push(f.pushback);
            f.pushback = EMPTY;
        } else {
            parts.push(f.pushback.subarray(0, index));
            f.pushback = f.pushback.subarray(index + 1);
            found = true;
            break;
        }
    }
    if (!chop && found)
        parts.push(new Uint8Array([10]));
    let result = concat_bytes(parts);
    push_bytes(L, result);
    /* return ok if read something (either a newline or something else) */
    return found || result.length > 0;
};

const isdigit = function(c) {
    return c >= 48 && c <= 57;
};

const isxdigit = function(c) {
    return isdigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
};

const isspace = function(c) {
    return c === 32 || (c >= 9 && c <= 13);
};

/* port of PUC's 'read_number': read a valid prefix of a numeral */
const read_number = function(L, f) {
    let c;
    let n = 0;
    let count = 0;
    let hex = false;
    let overflow = false;
    let buff = [];

    const nextc = function() {
        if (overflow)
            return false;
        if (n >= L_MAXLENNUM) {  /* buffer overflow? */
            overflow = true;
            buff = [];
            return false;  /* fail */
        }
        buff.push(c);
        n++;
        c = read_byte(f);
        return true;
    };
    const test2 = function(set) {
        if (c !== -1 && (c === set.charCodeAt(0) || c === set.charCodeAt(1)))
            return nextc();
        return false;
    };
    const readdigits = function(ishex) {
        let digits = 0;
        while (c !== -1 && (ishex ? isxdigit(c) : isdigit(c)) && nextc())
            digits++;
        return digits;
    };

    do { c = read_byte(f); } while (c !== -1 && isspace(c));  /* skip spaces */
    test2("-+");  /* optional sign */
    if (test2("00")) {
        if (test2("xX"))
            hex = true;  /* numeral is hexadecimal */
        else
            count = 1;  /* count initial '0' as a valid digit */
    }
    count += readdigits(hex);  /* integral part */
    if (test2(".."))  /* decimal point? */
        count += readdigits(hex);  /* fractional part */
    if (count > 0 && test2(hex ? "pP" : "eE")) {  /* exponent mark? */
        test2("-+");  /* exponent sign */
        readdigits(false);  /* exponent digits */
    }
    unread_byte(f, c);  /* unread look-ahead char */
    if (lua_stringtonumber(L, Uint8Array.from(buff)))
        return true;  /* ok */
    lua_pushnil(L);  /* "result" to be removed */
    return false;  /* read fails */
};

const test_eof = function(L, f) {
    let c = read_byte(f);
    unread_byte(f, c);  /* no-op when c == EOF */
    lua_pushliteral(L, "");
    return c !== -1;
};

const g_read = function(L, f, first) {
    let nargs = lua_gettop(L) - first + 1;
    let success;
    let n;
    if (!flush_write(f))
        return luaL_fileresult(L, false, null, f.error);
    f.error = null;  /* clearerr */
    if (nargs === 0) {  /* no arguments? */
        success = read_line(L, f, true);
        n = first + 1;  /* to return 1 result */
    } else {
        luaL_checkstack(L, nargs + LUA_MINSTACK, to_luastring("too many arguments"));
        success = true;
        for (n = first; nargs-- > 0 && success; n++) {
            if (lua_type(L, n) === LUA_TNUMBER) {
                let l = luaL_checkinteger(L, n);
                if (l < 0)
                    return luaL_argerror(L, n, to_luastring("invalid count"));
                success = (l === 0) ? test_eof(L, f) : read_chars(L, f, l);
            } else {
                let spec = luaL_checkstring(L, n);
                if (spec[0] === 42 /* '*' */)
                    spec = spec.subarray(1);  /* skip optional '*' (for compatibility) */
                switch (spec[0]) {
                    case 110:  /* 'n' number */
                        success = read_number(L, f);
                        break;
                    case 108:  /* 'l' line */
                        success = read_line(L, f, true);
                        break;
                    case 76:  /* 'L' line with end-of-line */
                        success = read_line(L, f, false);
                        break;
                    case 97:  /* 'a' whole file */
                        read_all(L, f);
                        success = true;
                        break;
                    default:
                        return luaL_argerror(L, n, to_luastring("invalid format"));
                }
            }
        }
    }
    if (f.error) {
        let e = f.error;
        f.error = null;
        return luaL_fileresult(L, false, null, e);
    }
    if (!success) {
        lua_pop(L, 1);  /* remove last result */
        lua_pushnil(L);  /* push nil instead */
    }
    return n - first;
};

const io_read = function(L) {
    return g_read(L, getiofile(L, IO_INPUT), 1);
};

const f_read = function(L) {
    return g_read(L, tofile(L), 2);
};

/* ---------------------------------------------------------------------- */
/* writing                                                                */
/* ---------------------------------------------------------------------- */

const g_write = function(L, f, arg) {
    let nargs = lua_gettop(L) - arg;
    let status = true;
    for (; nargs-- > 0; arg++) {
        let s = luaL_checklstring(L, arg);
        status = write_at(f, s) && status;
    }
    if (status) return 1;  /* file handle already on stack top */
    let e = f.error;
    f.error = null;
    return luaL_fileresult(L, status, null, e);
};

const io_write = function(L) {
    /* the output file handle stays on the stack: it is the value that every
       write returns */
    lua_getfield(L, LUA_REGISTRYINDEX, IO_OUTPUT);
    let f = checkiofile(L, lua_touserdata(L, -1), IO_OUTPUT);
    return g_write(L, f, 1);
};

const f_write = function(L) {
    let f = tofile(L);
    lua_pushvalue(L, 1);  /* push file at the stack top (to be returned) */
    return g_write(L, f, 2);
};

const flush_stream = function(f) {
    /* flush pending output; for fd based streams this is fsync, which is not
       meaningful (and fails) for pipes and terminals */
    if (!flush_write(f))
        return false;
    try {
        f.handle.sync();
        return true;
    } catch (e) {
        if (e && (e.code === "EINVAL" || e.code === "ENOTSUP" || e.code === "ESPIPE"))
            return true;
        f.error = e;
        return false;
    }
};

const io_flush = function(L) {
    let f = getiofile(L, IO_OUTPUT);
    let status = flush_stream(f);
    let e = f.error;
    f.error = null;
    return luaL_fileresult(L, status, null, e);
};

const f_flush = function(L) {
    let f = tofile(L);
    let status = flush_stream(f);
    let e = f.error;
    f.error = null;
    return luaL_fileresult(L, status, null, e);
};

/* ---------------------------------------------------------------------- */
/* opening and closing files                                              */
/* ---------------------------------------------------------------------- */

/* 'mode' matches '[rwa]%+?b*', as in PUC Lua */
const l_checkmode = function(mode) {
    if (mode.length === 0 || "rwa".indexOf(mode[0]) === -1)
        return false;
    let i = 1;
    if (mode[i] === '+')
        i++;
    for (; i < mode.length; i++)
        if (mode[i] !== 'b')
            return false;
    return true;
};

const open_stream = function(filename, mode) {
    let handle = lfs.open(filename, mode);
    return new LStream(handle, lfs.path_to_string(filename), {
        seekable: true,
        append: mode[0] === 'a'
    });
};

const newfile = function(L) {
    let p = newprefile(L);
    p.f = null;
    p.closef = io_fclose;
    return p;
};

const opencheck = function(L, filename, mode) {
    let p = newfile(L);
    try {
        p.f = open_stream(filename, mode);
    } catch (e) {
        luaL_error(L, to_luastring("cannot open file '%s' (%s)"), filename, to_luastring(e.message));
    }
    return p;
};

const io_open = function(L) {
    let filename = luaL_checkstring(L, 1);
    let mode = lfs.to_jsstring(luaL_optstring(L, 2, to_luastring("r")));
    if (!l_checkmode(mode))
        return luaL_argerror(L, 2, to_luastring("invalid mode"));
    let p = newfile(L);
    try {
        p.f = open_stream(filename, mode);
    } catch (e) {
        return luaL_fileresult(L, false, filename, e);
    }
    return 1;
};

const io_fclose = function(L) {
    let p = tolstream(L);
    let f = p.f;
    let status = flush_write(f);
    let err = f.error;
    try {
        f.handle.close();
    } catch (e) {
        status = false;
        err = e;
    }
    if (f.cleanup) {
        try {
            f.cleanup();
        } catch (e) {
            /* best effort cleanup */
        }
    }
    return luaL_fileresult(L, status, null, err);
};

const f_close = function(L) {
    tofile(L);  /* make sure argument is an open stream */
    return aux_close(L);
};

const io_close = function(L) {
    if (lua_isnone(L, 1))  /* no argument? */
        lua_getfield(L, LUA_REGISTRYINDEX, IO_OUTPUT);  /* use standard output */
    return f_close(L);
};

const io_noclose = function(L) {
    let p = tolstream(L);
    p.closef = io_noclose;  /* keep file opened */
    lua_pushnil(L);
    lua_pushliteral(L, "cannot close standard file");
    return 2;
};

const f_gc = function(L) {
    let p = tolstream(L);
    if (!isclosed(p) && p.f !== null)
        aux_close(L);  /* ignore closed and incompletely open files */
    return 0;
};

/* ---------------------------------------------------------------------- */
/* temporary files and pipes                                              */
/* ---------------------------------------------------------------------- */

const io_tmpfile = function(L) {
    let p = newfile(L);
    try {
        let info = lfs.openTemp();
        p.f = new LStream(info.handle, info.name, {
            seekable: true,
            cleanup: info.cleanup
        });
    } catch (e) {
        return luaL_fileresult(L, false, null, e);
    }
    return 1;
};

const io_pclose = function(L) {
    let p = tolstream(L);
    let info = p.f.popen;
    /* io_pclose is only installed for popen handles; be defensive anyway */
    if (!info)
        return luaL_fileresult(L, true, null, null);
    let flushed = flush_write(p.f);
    let result = info.close();
    if (!flushed)
        return luaL_fileresult(L, false, null, p.f.error);
    if (result.error)
        return luaL_fileresult(L, false, null, result.error);
    if (result.signal)
        return luaL_execresult(L, { signal: result.signal });
    return luaL_execresult(L, result.status === 0 ? null : { status: result.status });
};

const io_popen = function(L) {
    let command = luaL_checkstring(L, 1);
    let mode = lfs.to_jsstring(luaL_optstring(L, 2, to_luastring("r")));
    if (!(mode === "r" || mode === "w"))
        return luaL_argerror(L, 2, to_luastring("invalid mode"));

    let info = lfs.popen(command, mode);
    if (info === null)
        return luaL_error(L, to_luastring("'popen' not supported"));
    if (info.error)
        return luaL_fileresult(L, false, command, info.error);

    let p = newprefile(L);
    p.f = new LStream(info.handle, `popen (${lfs.path_to_string(command)})`, {
        seekable: true,
        cleanup: info.cleanup,
        popen: info
    });
    p.closef = io_pclose;
    return 1;
};

/* ---------------------------------------------------------------------- */
/* default input/output files                                             */
/* ---------------------------------------------------------------------- */

const getiofile = function(L, findex) {
    lua_getfield(L, LUA_REGISTRYINDEX, findex);
    let f = checkiofile(L, lua_touserdata(L, -1), findex);
    lua_pop(L, 1);
    return f;
};

const g_iofile = function(L, f, mode) {
    if (!lua_isnoneornil(L, 1)) {
        let filename = lua_tostring(L, 1);
        if (filename)
            opencheck(L, filename, mode);
        else {
            tofile(L);  /* check that it's a valid file handle */
            lua_pushvalue(L, 1);
        }
        lua_setfield(L, LUA_REGISTRYINDEX, f);
    }
    /* return current value */
    lua_getfield(L, LUA_REGISTRYINDEX, f);
    return 1;
};

const io_input = function(L) {
    return g_iofile(L, IO_INPUT, "r");
};

const io_output = function(L) {
    return g_iofile(L, IO_OUTPUT, "w");
};

/* ---------------------------------------------------------------------- */
/* iterators                                                              */
/* ---------------------------------------------------------------------- */

const io_readline = function(L) {
    let p = lua_touserdata(L, lua_upvalueindex(1));
    let n = lua_tointeger(L, lua_upvalueindex(2));
    if (isclosed(p))  /* file is already closed? */
        return luaL_error(L, to_luastring("file is already closed"));
    lua_settop(L, 0);
    luaL_checkstack(L, n, to_luastring("too many arguments"));
    for (let i = 1; i <= n; i++)  /* push arguments to 'g_read' */
        lua_pushvalue(L, lua_upvalueindex(3 + i));
    let count = g_read(L, p.f, 1);
    if (lua_toboolean(L, -count))  /* read at least one value? */
        return count;
    /* first result is nil: EOF or error */
    if (count > 1)  /* is there error information? */
        return luaL_error(L, to_luastring("%s"), lua_tostring(L, -count + 1));
    if (lua_toboolean(L, lua_upvalueindex(3))) {  /* generator created file? */
        lua_settop(L, 0);
        lua_pushvalue(L, lua_upvalueindex(1));
        aux_close(L);  /* close it */
    }
    return 0;
};

const aux_lines = function(L, toclose) {
    let n = lua_gettop(L) - 1;  /* number of arguments to read */
    if (n > MAXARGLINE)
        return luaL_argerror(L, MAXARGLINE + 2, to_luastring("too many arguments"));
    lua_pushinteger(L, n);  /* number of arguments to read */
    lua_pushboolean(L, toclose);  /* close/not close file when finished */
    lua_rotate(L, 2, 2);  /* move 'n' and 'toclose' to their positions */
    lua_pushcclosure(L, io_readline, 3 + n);
    return 1;
};

const f_lines = function(L) {
    tofile(L);  /* check that it's a valid file handle */
    return aux_lines(L, false);
};

const io_lines = function(L) {
    let toclose;
    if (lua_isnone(L, 1))
        lua_pushnil(L);  /* at least one argument */
    if (lua_isnoneornil(L, 1)) {  /* no file name? */
        lua_getfield(L, LUA_REGISTRYINDEX, IO_INPUT);  /* get default input */
        lua_replace(L, 1);  /* put it at index 1 */
        tofile(L);  /* check that it's a valid file handle */
        toclose = false;  /* do not close it after iteration */
    } else {  /* open a new file */
        let filename = luaL_checkstring(L, 1);
        opencheck(L, filename, "r");
        lua_replace(L, 1);  /* put file at index 1 */
        toclose = true;  /* close it after iteration */
    }
    return aux_lines(L, toclose);
};

/* ---------------------------------------------------------------------- */
/* seeking and buffering                                                  */
/* ---------------------------------------------------------------------- */

const f_seek = function(L) {
    let f = tofile(L);
    if (!flush_write(f))
        return luaL_fileresult(L, false, null, f.error);
    let op = luaL_checkoption(L, 2, to_luastring("cur"),
        [to_luastring("set"), to_luastring("cur"), to_luastring("end")]);
    let offset = luaL_optinteger(L, 3, 0);
    if (f.pos === null)
        return luaL_fileresult(L, false, null, ESPIPE);
    let base;
    if (op === 0)
        base = 0;
    else if (op === 1)
        base = logical_pos(f);
    else {
        try {
            base = f.handle.size();
        } catch (e) {
            return luaL_fileresult(L, false, null, e);
        }
    }
    let position = base + offset;
    if (position < 0)
        return luaL_fileresult(L, false, null, EINVAL);
    f.pushback = EMPTY;
    f.pos = position;
    lua_pushinteger(L, position);
    return 1;
};

const f_setvbuf = function(L) {
    let f = tofile(L);
    let op = luaL_checkoption(L, 2, null,
        [to_luastring("no"), to_luastring("full"), to_luastring("line")]);
    let size = luaL_optinteger(L, 3, READ_CHUNK);
    if (!flush_write(f))
        return luaL_fileresult(L, false, null, f.error);
    f.vbuf = ["no", "full", "line"][op];
    f.vbufsize = size > 0 ? size : READ_CHUNK;
    return luaL_fileresult(L, true, null, null);
};

/* ---------------------------------------------------------------------- */
/* library registration                                                   */
/* ---------------------------------------------------------------------- */

const iolib = {
    "close": io_close,
    "flush": io_flush,
    "input": io_input,
    "lines": io_lines,
    "open": io_open,
    "output": io_output,
    "popen": io_popen,
    "read": io_read,
    "tmpfile": io_tmpfile,
    "type": io_type,
    "write": io_write
};

const flib = {
    "close": f_close,
    "flush": f_flush,
    "lines": f_lines,
    "read": f_read,
    "seek": f_seek,
    "setvbuf": f_setvbuf,
    "write": f_write,
    "__gc": f_gc,
    "__tostring": f_tostring
};

const createmeta = function(L) {
    luaL_newmetatable(L, LUA_FILEHANDLE);  /* create metatable for file handles */
    lua_pushvalue(L, -1);  /* push metatable */
    lua_setfield(L, -2, to_luastring("__index", true));  /* metatable.__index = metatable */
    luaL_setfuncs(L, flib, 0);  /* add file methods to new metatable */
    lua_pop(L, 1);  /* pop new metatable */
};

const createstdfile = function(L, handle, k, fname) {
    let p = newprefile(L);
    p.f = new LStream(handle, lfs.path_to_string(fname), { seekable: false });
    p.closef = io_noclose;
    if (k !== null) {
        lua_pushvalue(L, -1);
        lua_setfield(L, LUA_REGISTRYINDEX, k);  /* add file to registry */
    }
    lua_setfield(L, -2, fname);  /* add file to module */
};

const luaopen_io = function(L) {
    luaL_newlib(L, iolib);
    createmeta(L);
    /* create (and set) default files */
    createstdfile(L, lfs.stdin(), IO_INPUT, to_luastring("stdin"));
    createstdfile(L, lfs.stdout(), IO_OUTPUT, to_luastring("stdout"));
    createstdfile(L, lfs.stderr(), null, to_luastring("stderr"));
    return 1;
};

module.exports.luaopen_io = luaopen_io;
