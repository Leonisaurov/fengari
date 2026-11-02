"use strict";

/**
 * High level helpers on top of the C API, plus a small sandbox.
 *
 * The C API remains the source of truth; this module only wraps the common
 * flows (load, call, convert values, limit execution) so hosts do not need to
 * juggle the Lua stack for simple tasks.
 */

const {
    LUA_MASKCOUNT,
    LUA_MULTRET,
    LUA_OK,
    lua_close,
    lua_createtable,
    lua_getglobal,
    lua_gettop,
    lua_isinteger,
    lua_isnil,
    lua_pop,
    lua_pushboolean,
    lua_pushcfunction,
    lua_pushinteger,
    lua_pushnil,
    lua_pushnumber,
    lua_pushstring,
    lua_pushvalue,
    lua_rawgeti,
    lua_rawlen,
    lua_rawseti,
    lua_pcall,
    lua_sethook,
    lua_setglobal,
    lua_settable,
    lua_settop,
    lua_toboolean,
    lua_tointeger,
    lua_tonumber,
    lua_topointer,
    lua_tostring,
    lua_type,
    lua_next,
    LUA_TBOOLEAN,
    LUA_TNIL,
    LUA_TNUMBER,
    LUA_TSTRING,
    LUA_TTABLE
} = require('./lua.js');
const {
    luaL_error,
    luaL_loadbuffer,
    luaL_loadfile,
    luaL_newstate,
    luaL_traceback
} = require('./lauxlib.js');
const lualib = require('./lualib.js');
const { to_jsstring, to_luastring } = require("./fengaricore.js");

const MAX_DEPTH = 100;

const message_of = function(L) {
    let raw = lua_tostring(L, -1);
    return raw === null ? to_luastring("(non-string error)") : raw;
};

const throw_error = function(L, status) {
    let raw = message_of(L);
    let message = to_jsstring(raw);
    luaL_traceback(L, L, raw, 1);
    let trace = lua_tostring(L, -1);
    let error = new Error(message);
    error.status = status;
    error.luaMessage = message;
    if (trace !== null)
        error.luaTraceback = to_jsstring(trace);
    lua_pop(L, 2);  /* traceback and original error */
    throw error;
};

const abs_index = function(L, idx) {
    return idx < 0 ? lua_gettop(L) + idx + 1 : idx;
};

/**
 * Convert the value at 'idx' to a JS value. Tables become arrays when they
 * have a 1..n sequence, plain objects otherwise. Cycles are rejected.
 */
const toJS = function(L, idx) {
    return convert(L, idx, new Map(), 0);
};

const convert = function(L, idx, seen, depth) {
    if (depth > MAX_DEPTH)
        throw new Error("Lua value is nested too deeply");
    idx = abs_index(L, idx);
    let type = lua_type(L, idx);
    switch (type) {
        case LUA_TNIL:
            return null;
        case LUA_TBOOLEAN:
            return lua_toboolean(L, idx);
        case LUA_TNUMBER:
            return lua_isinteger(L, idx) ? lua_tointeger(L, idx) : lua_tonumber(L, idx);
        case LUA_TSTRING: {
            let s = lua_tostring(L, idx);
            return s === null ? null : to_jsstring(s);
        }
        case LUA_TTABLE:
            return convert_table(L, idx, seen, depth);
        default: {
            let s = lua_tostring(L, idx);
            return s === null ? null : to_jsstring(s);
        }
    }
};

const convert_table = function(L, idx, seen, depth) {
    let pointer = lua_topointer(L, idx);
    if (pointer !== null && seen.has(pointer))
        throw new Error("Lua table contains a cycle");
    if (pointer !== null)
        seen.set(pointer, true);

    let top = lua_gettop(L);
    let length = lua_rawlen(L, idx);
    let is_array = length > 0;
    for (let i = 1; i <= length; i++) {
        lua_rawgeti(L, idx, i);
        if (lua_isnil(L, -1))
            is_array = false;
        lua_pop(L, 1);
        if (!is_array)
            break;
    }

    let result;
    if (is_array) {
        result = [];
        for (let i = 1; i <= length; i++) {
            lua_rawgeti(L, idx, i);
            result.push(convert(L, -1, seen, depth + 1));
            lua_pop(L, 1);
        }
    } else {
        result = {};
        lua_pushnil(L);
        while (lua_next(L, idx) !== 0) {
            let key = convert(L, -2, seen, depth + 1);
            let value = convert(L, -1, seen, depth + 1);
            result[String(key)] = value;
            lua_pop(L, 1);
        }
    }
    lua_settop(L, top);
    if (pointer !== null)
        seen.delete(pointer);
    return result;
};

/**
 * Push a JS value onto the Lua stack. Functions are wrapped as C functions:
 * arguments are converted with toJS and the result (if not undefined) with
 * pushJS.
 */
const pushJS = function(L, value) {
    if (value === null || value === undefined) {
        lua_pushnil(L);
    } else if (typeof value === "boolean") {
        lua_pushboolean(L, value);
    } else if (typeof value === "number") {
        if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
            lua_pushinteger(L, value);
        else
            lua_pushnumber(L, value);
    } else if (typeof value === "string") {
        lua_pushstring(L, to_luastring(value));
    } else if (value instanceof Uint8Array) {
        lua_pushstring(L, value);
    } else if (Array.isArray(value)) {
        lua_createtable(L, value.length, 0);
        for (let i = 0; i < value.length; i++) {
            pushJS(L, value[i]);
            lua_rawseti(L, -2, i + 1);
        }
    } else if (typeof value === "function") {
        lua_pushcfunction(L, function(L1) {
            try {
                let args = [];
                let n = lua_gettop(L1);
                for (let i = 1; i <= n; i++)
                    args.push(toJS(L1, i));
                let result = value.apply(null, args);
                if (result === undefined)
                    return 0;
                pushJS(L1, result);
                return 1;
            } catch (e) {
                let message = e && e.message !== undefined ? e.message : String(e);
                return luaL_error(L1, to_luastring("%s"), to_luastring(message));
            }
        });
    } else if (typeof value === "object") {
        lua_createtable(L, 0, 0);
        for (let key of Object.keys(value)) {
            pushJS(L, key);
            pushJS(L, value[key]);
            lua_settable(L, -3);
        }
    } else {
        lua_pushnil(L);
    }
};

const collect_results = function(L, base) {
    let n = lua_gettop(L) - base;
    let results = [];
    for (let i = 1; i <= n; i++)
        results.push(toJS(L, base + i));
    lua_settop(L, base);
    if (n === 0)
        return undefined;
    return n === 1 ? results[0] : results;
};

const run_code = function(L, bytes, chunkname) {
    let base = lua_gettop(L);
    let status = luaL_loadbuffer(L, bytes, bytes.length, to_luastring(chunkname));
    if (status !== LUA_OK)
        throw_error(L, status);
    status = lua_pcall(L, 0, LUA_MULTRET, 0);
    if (status !== LUA_OK)
        throw_error(L, status);
    return collect_results(L, base);
};

const run = function(L, source, chunkname) {
    let bytes = typeof source === "string" ? to_luastring(source) : source;
    return run_code(L, bytes, chunkname || "=(run)");
};

const dofile = function(L, filename) {
    let base = lua_gettop(L);
    let status = luaL_loadfile(L, to_luastring(filename));
    if (status !== LUA_OK)
        throw_error(L, status);
    status = lua_pcall(L, 0, LUA_MULTRET, 0);
    if (status !== LUA_OK)
        throw_error(L, status);
    return collect_results(L, base);
};

const call = function(L, fn, args) {
    args = args || [];
    let top = lua_gettop(L);
    if (typeof fn === "string") {
        lua_getglobal(L, to_luastring(fn));
        if (lua_isnil(L, -1)) {
            lua_settop(L, top);
            throw new Error(`global '${fn}' is not a function`);
        }
    } else if (typeof fn === "number") {
        lua_pushvalue(L, fn);
    } else {
        throw new TypeError("call() expects a global name or a stack index");
    }
    let base = lua_gettop(L);
    for (let i = 0; i < args.length; i++)
        pushJS(L, args[i]);
    let status = lua_pcall(L, args.length, LUA_MULTRET, 0);
    if (status !== LUA_OK)
        throw_error(L, status);
    let results = collect_results(L, base - 1);
    lua_settop(L, top);
    return results;
};

/**
 * Create a state plus helpers bound to it.
 *
 *   const { L, run, call, close } = createState();
 *   run("return 1 + 2"); // 3
 */
const createState = function(options) {
    options = options || {};
    let L = luaL_newstate(options.version);
    if (!L)
        throw new Error("failed to create a Lua state");
    if (options.openlibs !== false)
        lualib.luaL_openlibs(L);
    return {
        L: L,
        run: (source, chunkname) => run(L, source, chunkname),
        dostring: (source, chunkname) => run(L, source, chunkname),
        dofile: (filename) => dofile(L, filename),
        call: (fn, args) => call(L, fn, args),
        toJS: (idx) => toJS(L, idx),
        pushJS: (value) => pushJS(L, value),
        close: () => lua_close(L)
    };
};

const DEFAULT_HIDDEN = ["io", "os", "package", "debug", "dofile", "loadfile", "require"];

/**
 * Create a restricted state.
 *
 * Options:
 *   instructions  maximum number of VM instructions per run (0 = no limit)
 *   milliseconds  maximum wall-clock time per run (0 = no limit)
 *   hide          globals to remove (defaults to io/os/package/debug/...)
 *   version       Lua version profile
 */
const sandbox = function(options) {
    options = options || {};
    let state = createState({ version: options.version });
    let L = state.L;

    let hidden = options.hide || DEFAULT_HIDDEN;
    for (let name of hidden) {
        lua_pushnil(L);
        lua_setglobal(L, to_luastring(name));
    }

    let instruction_limit = options.instructions || 0;
    let time_limit = options.milliseconds || 0;
    let steps = 0;
    let started = 0;

    if (instruction_limit > 0 || time_limit > 0) {
        lua_sethook(L, function(L1) {
            steps += 1000;
            if (instruction_limit > 0 && steps > instruction_limit)
                luaL_error(L1, to_luastring("instruction limit exceeded"));
            if (time_limit > 0 && Date.now() - started > time_limit)
                luaL_error(L1, to_luastring("time limit exceeded"));
        }, LUA_MASKCOUNT, 1000);
    }

    let reset = function() {
        steps = 0;
        started = Date.now();
    };

    let run_sandboxed = function(source, chunkname) {
        reset();
        return run(L, source, chunkname);
    };

    return {
        L: L,
        run: run_sandboxed,
        dostring: run_sandboxed,
        call: (fn, args) => {
            reset();
            return call(L, fn, args);
        },
        reset: reset,
        close: state.close
    };
};

module.exports.createState = createState;
module.exports.run = run;
module.exports.dostring = run;
module.exports.dofile = dofile;
module.exports.call = call;
module.exports.toJS = toJS;
module.exports.pushJS = pushJS;
module.exports.sandbox = sandbox;
