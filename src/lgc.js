"use strict";

/*
** Collector support for weak tables and finalizers.
**
** JavaScript's collector cannot see the Lua object graph, and WeakRef targets
** are kept alive until the end of the current job, so it cannot implement
** Lua's synchronous weak-table semantics. Instead, collectgarbage() runs a
** small mark/sweep over the objects reachable from the Lua state:
**   - weak keys/values are not traversed as strong edges,
**   - ephemeron tables (weak keys, strong values) are iterated to a fixpoint,
**   - entries whose weak side is unreachable are removed,
**   - unreachable objects marked with __gc are finalized once.
** Objects must be anchored in the Lua state (stack, registry, upvalue, table)
** to count as reachable, exactly like C pointers in PUC Lua.
*/

const {
    LUA_TTABLE,
    LUA_TUSERDATA,
    luastring_indexOf,
    thread_status: { LUA_OK },
    to_luastring
} = require('./defs.js');
const lfunc   = require('./lfunc.js');
const lobject = require('./lobject.js');
const lstate  = require('./lstate.js');
const ltable  = require('./ltable.js');
const ltm     = require('./ltm.js');

const WEAK_KEYS   = 1;
const WEAK_VALUES = 2;

const table_mode = function(L, t, modes) {
    let mode = modes.get(t);
    if (mode !== undefined)
        return mode;

    mode = 0;
    const mt = t.metatable;
    if (mt !== null) {
        const tv = ltable.luaH_getstr(mt, L.l_G.tmname[ltm.TMS.TM_MODE]);
        if (tv.ttisstring()) {
            const s = tv.svalue();
            if (luastring_indexOf(s, 107 /* 'k' */) >= 0) mode |= WEAK_KEYS;
            if (luastring_indexOf(s, 118 /* 'v' */) >= 0) mode |= WEAK_VALUES;
        }
    }
    modes.set(t, mode);
    return mode;
};

/* Is this value subject to collection at all? Strings, numbers, booleans,
   light userdata and light C functions are never removed from weak tables. */
const iscollectable = function(tv) {
    return tv.ttistable() || tv.ttisfulluserdata() ||
        tv.ttisLclosure() || tv.ttisCclosure() || tv.ttisthread();
};

const gc_cycle = function(L) {
    const g = L.l_G;
    const marked = new Set();
    const work = [];
    const modes = new Map();
    const weak_tables = [];
    const weak_seen = new Set();
    const ephemerons = [];

    const mark_object = function(o) {
        if (!o || marked.has(o))
            return;
        marked.add(o);
        work.push(o);
    };

    const mark_table = function(t) {
        if (t)
            mark_object(t);
    };

    const mark_tvalue = function(tv) {
        if (iscollectable(tv))
            mark_object(tv.value);
    };

    const is_alive = function(tv) {
        return !iscollectable(tv) || marked.has(tv.value);
    };

    const traverse_table = function(t) {
        const mode = table_mode(L, t, modes);
        if (mode !== 0 && !weak_seen.has(t)) {
            weak_seen.add(t);
            weak_tables.push(t);
        }

        mark_table(t.metatable);

        const weakk = (mode & WEAK_KEYS) !== 0;
        const weakv = (mode & WEAK_VALUES) !== 0;
        if (weakk && !weakv)
            ephemerons.push(t);

        for (const entry of t.strong.values()) {
            if (!weakk)
                mark_tvalue(entry.key);
            if (!weakv && !weakk)
                mark_tvalue(entry.value);
            /* weak keys with strong values are handled by the ephemeron pass */
        }
    };

    const traverse_udata = function(u) {
        mark_table(u.metatable);
        mark_tvalue(u.uservalue);
    };

    const traverse_lclosure = function(f) {
        mark_object(f.p);
        for (const up of f.upvals)
            if (up) mark_tvalue(up);
    };

    const traverse_cclosure = function(f) {
        for (const up of f.upvalue)
            if (up) mark_tvalue(up);
    };

    const traverse_thread = function(L1) {
        if (L1.stack) {
            for (let i = 0; i < L1.top; i++) {
                const tv = L1.stack[i];
                if (tv) mark_tvalue(tv);
            }
        }
        for (let ci = L1.ci; ci; ci = ci.previous)
            if (ci.func) mark_tvalue(ci.func);
    };

    const traverse_proto = function(p) {
        for (const tv of p.k)
            mark_tvalue(tv);
        for (const sub of p.p)
            mark_object(sub);
        if (p.cache)
            mark_object(p.cache);
    };

    const drain = function() {
        while (work.length > 0) {
            const o = work.pop();
            if (o instanceof ltable.Table)
                traverse_table(o);
            else if (o instanceof lobject.Udata)
                traverse_udata(o);
            else if (o instanceof lobject.LClosure)
                traverse_lclosure(o);
            else if (o instanceof lobject.CClosure)
                traverse_cclosure(o);
            else if (o instanceof lstate.lua_State)
                traverse_thread(o);
            else if (o instanceof lfunc.Proto)
                traverse_proto(o);
        }
    };

    /* roots: the running thread, the main thread, the registry and the
       per-type metatables installed through debug.setmetatable */
    mark_object(L);
    mark_object(g.mainthread);
    mark_tvalue(g.l_registry);
    for (const mt of g.mt)
        mark_table(mt);

    drain();

    /* ephemerons: a value is strong only while its key is reachable */
    let previous;
    do {
        previous = marked.size;
        const tables = ephemerons.slice();
        for (const t of tables) {
            for (const entry of t.strong.values()) {
                if (is_alive(entry.key))
                    mark_tvalue(entry.value);
            }
        }
        drain();
    } while (marked.size !== previous);

    /* clear entries whose weak side did not survive */
    for (const t of weak_tables) {
        const mode = modes.get(t);
        for (const [hash, entry] of t.strong) {
            if (((mode & WEAK_KEYS) && !is_alive(entry.key)) ||
                ((mode & WEAK_VALUES) && !is_alive(entry.value)))
                ltable.luaH_removeentry(t, hash, entry);
        }
    }

    /* finalize unreachable objects; reachable ones stay in the pending set */
    const pending = Array.from(g.finalizable).reverse();
    for (const obj of pending) {
        if (!marked.has(obj)) {
            g.finalizable.delete(obj);
            if (!obj.finalized) {
                obj.finalized = true;
                run_finalizer(L, obj, true);
            }
        }
    }
};

const run_finalizer = function(L, obj, propagate) {
    const mt = obj.metatable;
    if (!mt)
        return;

    const tm = ltable.luaH_getstr(mt, L.l_G.tmname[ltm.TMS.TM_GC]);
    if (tm.ttisnil())
        return;

    /* required lazily to avoid a cycle: lapi requires this module */
    const lapi = require('./lapi.js');
    if (!lapi.lua_checkstack(L, 2))
        return;

    const top = L.top;
    L.stack[L.top++] = new lobject.TValue(tm.type, tm.value);
    L.stack[L.top++] = new lobject.TValue(
        obj instanceof ltable.Table ? LUA_TTABLE : LUA_TUSERDATA, obj);

    const status = lapi.lua_pcall(L, 1, 0, 0);
    if (status !== LUA_OK) {
        if (propagate) {
            let msg = lapi.lua_tostring(L, -1);
            lapi.lua_pop(L, 1);
            lapi.lua_pushfstring(L, to_luastring("error in __gc metamethod (%s)"),
                msg === null ? to_luastring("?") : msg);
            lapi.lua_error(L);  /* leave the error for the caller */
        }
        L.top = top;
        return;
    }
    L.top = top;
};

/* Register an object for finalization when a metatable with __gc is set. */
const luaC_checkfinalizer = function(L, obj, mt) {
    if (obj.finalized || !mt)
        return;
    const tm = ltable.luaH_getstr(mt, L.l_G.tmname[ltm.TMS.TM_GC]);
    if (!tm.ttisnil())
        L.l_G.finalizable.add(obj);
};

const luaC_fullgc = function(L) {
    const g = L.l_G;
    if (g.in_gc)  /* a finalizer called collectgarbage */
        return;
    g.in_gc = true;
    try {
        gc_cycle(L);
    } finally {
        g.in_gc = false;
    }
};

/* At state close PUC runs every pending finalizer, reachable or not. */
const luaC_freeallobjects = function(L) {
    const g = L.l_G;
    if (!g)
        return;
    const pending = Array.from(g.finalizable).reverse();
    for (const obj of pending) {
        g.finalizable.delete(obj);
        if (!obj.finalized) {
            obj.finalized = true;
            run_finalizer(L, obj, false);
        }
    }
};

module.exports.luaC_checkfinalizer = luaC_checkfinalizer;
module.exports.luaC_freeallobjects  = luaC_freeallobjects;
module.exports.luaC_fullgc          = luaC_fullgc;
