"use strict";

/*
** Collector support for weak tables, finalizers and memory accounting.
**
** JavaScript's collector cannot observe Lua liveness synchronously, so
** collectgarbage runs a mark/sweep over the Lua object graph:
**   - weak keys/values are not traversed as strong edges,
**   - ephemeron tables (weak keys, strong values) are iterated to a fixpoint,
**   - entries whose weak side is unreachable are removed,
**   - unreachable objects marked with __gc are finalized once.
**
** Full cycles (collect, automatic collection, state close) are atomic.
** collectgarbage("step") starts with an atomic mark and then clears weak
** entries and runs finalizers in bounded batches, so the expensive part can
** be spread over several calls. Objects must be anchored in the Lua state
** (stack, registry, upvalue, table) to count as reachable, like C pointers.
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

/* rough per-object sizes, used only by collectgarbage("count") */
const TVALUE_SIZE     = 16;
const TABLE_OVERHEAD  = 56;
const ENTRY_SIZE      = 40;
const CLOSURE_OVERHEAD = 40;
const UDATA_OVERHEAD  = 32;
const STRING_OVERHEAD = 24;
const THREAD_OVERHEAD = 120;
const PROTO_OVERHEAD  = 96;

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

const object_size = function(o) {
    if (o instanceof ltable.Table)
        return TABLE_OVERHEAD + o.strong.size * ENTRY_SIZE;
    if (o instanceof lobject.Udata)
        return UDATA_OVERHEAD + o.len;
    if (o instanceof lobject.LClosure)
        return CLOSURE_OVERHEAD + o.nupvalues * TVALUE_SIZE;
    if (o instanceof lobject.CClosure)
        return CLOSURE_OVERHEAD + o.nupvalues * TVALUE_SIZE;
    if (o instanceof lstate.lua_State)
        return THREAD_OVERHEAD + (o.stack ? o.stack.length * TVALUE_SIZE : 0);
    if (o instanceof lfunc.Proto)
        return PROTO_OVERHEAD + o.code.length * 4 + o.k.length * TVALUE_SIZE +
            o.p.length * 8 + o.lineinfo.length * 4 + o.upvalues.length * 8 +
            o.locvars.length * 24;
    return 0;
};

/*
** Build the reachable set. When include_strings is true, strings referenced
** by live values are tracked too (for memory accounting); they are never
** considered dead for weak-table purposes.
*/
const mark_phase = function(L, include_strings) {
    const g = L.l_G;
    const ctx = {
        marked: new Set(),
        strings: include_strings ? new Set() : null,
        work: [],
        modes: new Map(),
        weak_tables: [],
        weak_seen: new Set(),
        ephemerons: [],
        weak_index: 0,
        weak_iter: null,
        finalize: [],
        finalize_index: 0
    };

    const mark_object = function(o) {
        if (!o || ctx.marked.has(o))
            return;
        ctx.marked.add(o);
        ctx.work.push(o);
    };

    const mark_table = function(t) {
        if (t)
            mark_object(t);
    };

    const mark_tvalue = function(tv) {
        if (tv.ttisstring()) {
            if (ctx.strings)
                ctx.strings.add(tv.value);
            return;
        }
        if (iscollectable(tv))
            mark_object(tv.value);
    };

    const is_alive = function(tv) {
        return !iscollectable(tv) || ctx.marked.has(tv.value);
    };

    const traverse_table = function(t) {
        const mode = table_mode(L, t, ctx.modes);
        if (mode !== 0 && !ctx.weak_seen.has(t)) {
            ctx.weak_seen.add(t);
            ctx.weak_tables.push(t);
        }

        mark_table(t.metatable);

        const weakk = (mode & WEAK_KEYS) !== 0;
        const weakv = (mode & WEAK_VALUES) !== 0;
        if (weakk && !weakv)
            ctx.ephemerons.push(t);

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
        while (ctx.work.length > 0) {
            const o = ctx.work.pop();
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

    const drain_ephemerons = function() {
        let previous;
        do {
            previous = ctx.marked.size;
            for (const t of ctx.ephemerons) {
                for (const entry of t.strong.values()) {
                    if (is_alive(entry.key))
                        mark_tvalue(entry.value);
                }
            }
            drain();
        } while (ctx.marked.size !== previous);
    };

    const mark_roots = function() {
        mark_object(L);
        mark_object(g.mainthread);
        mark_tvalue(g.l_registry);
        for (const mt of g.mt)
            mark_table(mt);
    };

    /* Re-scan roots between incremental steps so values anchored while the
       collector was suspended are not treated as dead. */
    ctx.remark = function() {
        mark_roots();
        drain();
        drain_ephemerons();
    };

    mark_roots();
    drain();
    drain_ephemerons();

    for (const obj of g.finalizable) {
        if (!ctx.marked.has(obj))
            ctx.finalize.push(obj);
    }
    ctx.finalize.reverse();

    return ctx;
};

const entry_is_dead = function(ctx, mode, entry) {
    const is_alive = function(tv) {
        return !iscollectable(tv) || ctx.marked.has(tv.value);
    };
    return ((mode & WEAK_KEYS) && !is_alive(entry.key)) ||
        ((mode & WEAK_VALUES) && !is_alive(entry.value));
};

const clear_weak_entries = function(ctx) {
    for (const t of ctx.weak_tables) {
        const mode = ctx.modes.get(t);
        for (const [hash, entry] of t.strong) {
            if (entry_is_dead(ctx, mode, entry))
                ltable.luaH_removeentry(t, hash, entry);
        }
    }
};

const run_pending_finalizers = function(L, ctx, propagate) {
    const g = L.l_G;
    for (const obj of ctx.finalize) {
        if (ctx.marked.has(obj) || !g.finalizable.has(obj))
            continue;
        g.finalizable.delete(obj);
        if (!obj.finalized) {
            obj.finalized = true;
            run_finalizer(L, obj, propagate);
        }
    }
};

const reset_threshold = function(L, ctx) {
    const g = L.l_G;
    const pause = Math.max(0, g.gc_pause|0);
    g.gc_threshold = Math.max(256, Math.floor(ctx.marked.size * pause / 100));
    g.gc_debt = g.gc_threshold;
    g.gc_count = null;
    g.gc_needs_auto = ctx.weak_tables.length > 0 || g.finalizable.size > 0;
};

const luaC_fullgc = function(L) {
    const g = L.l_G;
    if (g.in_gc)
        return;
    g.gc_ctx = null;  /* discard any unfinished incremental cycle */
    g.in_gc = true;
    let ctx;
    try {
        ctx = mark_phase(L, false);
        clear_weak_entries(ctx);
        run_pending_finalizers(L, ctx, true);
    } finally {
        if (ctx) reset_threshold(L, ctx);
        g.in_gc = false;
    }
};

/*
** Incremental cycle: atomic mark, then bounded weak-clearing/finalization.
** Returns true when the cycle is complete.
*/
const luaC_step = function(L) {
    const g = L.l_G;
    if (!g.gc_running)
        return true;
    if (g.in_gc)
        return false;

    g.in_gc = true;
    try {
        let ctx = g.gc_ctx;
        if (!ctx) {
            ctx = mark_phase(L, false);
            g.gc_ctx = ctx;
        } else {
            ctx.remark();
        }

        let budget = Math.max(10, g.gc_stepmul|0);

        while (budget > 0 && ctx.weak_index < ctx.weak_tables.length) {
            const t = ctx.weak_tables[ctx.weak_index];
            const mode = ctx.modes.get(t);
            if (!ctx.weak_iter)
                ctx.weak_iter = t.strong.entries();
            while (budget > 0) {
                const next = ctx.weak_iter.next();
                if (next.done) {
                    ctx.weak_iter = null;
                    ctx.weak_index++;
                    break;
                }
                const hash = next.value[0];
                const entry = next.value[1];
                if (entry_is_dead(ctx, mode, entry))
                    ltable.luaH_removeentry(t, hash, entry);
                budget--;
            }
        }

        while (budget > 0 && ctx.finalize_index < ctx.finalize.length) {
            const obj = ctx.finalize[ctx.finalize_index++];
            if (!ctx.marked.has(obj) && g.finalizable.has(obj)) {
                g.finalizable.delete(obj);
                if (!obj.finalized) {
                    obj.finalized = true;
                    run_finalizer(L, obj, true);
                }
            }
            budget--;
        }

        if (ctx.weak_index >= ctx.weak_tables.length &&
            ctx.finalize_index >= ctx.finalize.length) {
            g.gc_ctx = null;
            reset_threshold(L, ctx);
            return true;
        }
        return false;
    } finally {
        g.in_gc = false;
    }
};

/* Called by allocations: trigger a full cycle after a budget of new objects. */
const luaC_allocated = function(L) {
    const g = L && L.l_G;
    if (!g)
        return;
    g.gc_count = null;
    if (!g.gc_auto || g.in_gc || g.gc_ctx || !g.gc_running || !g.gc_needs_auto)
        return;
    if (--g.gc_debt > 0)
        return;
    luaC_fullgc(L);
};

/* Total size (in bytes) of objects reachable from Lua roots. */
const luaC_count = function(L) {
    const g = L.l_G;
    if (g.in_gc)
        return g.gc_count === null ? 0 : g.gc_count;

    const ctx = mark_phase(L, true);
    let bytes = 0;
    for (const o of ctx.marked)
        bytes += object_size(o);
    if (ctx.strings) {
        for (const s of ctx.strings)
            bytes += STRING_OVERHEAD + s.tsslen();
    }
    g.gc_count = bytes;
    return bytes;
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

/* Register an object for finalization when a metatable with __gc is set, and
   notice weak modes so that automatic collection can be enabled. */
const luaC_checkfinalizer = function(L, obj, mt) {
    const g = L.l_G;
    if (!mt)
        return;

    const tm = ltable.luaH_getstr(mt, g.tmname[ltm.TMS.TM_GC]);
    if (!tm.ttisnil() && !obj.finalized) {
        g.finalizable.add(obj);
        g.gc_needs_auto = true;
    }

    const mode = ltable.luaH_getstr(mt, g.tmname[ltm.TMS.TM_MODE]);
    if (mode.ttisstring()) {
        const s = mode.svalue();
        if (luastring_indexOf(s, 107 /* 'k' */) >= 0 ||
            luastring_indexOf(s, 118 /* 'v' */) >= 0)
            g.gc_needs_auto = true;
    }
};

/* At state close PUC runs every pending finalizer, reachable or not. */
const luaC_freeallobjects = function(L) {
    const g = L.l_G;
    if (!g)
        return;
    g.gc_ctx = null;
    const pending = Array.from(g.finalizable).reverse();
    for (const obj of pending) {
        g.finalizable.delete(obj);
        if (!obj.finalized) {
            obj.finalized = true;
            run_finalizer(L, obj, false);
        }
    }
};

module.exports.luaC_allocated      = luaC_allocated;
module.exports.luaC_checkfinalizer = luaC_checkfinalizer;
module.exports.luaC_count          = luaC_count;
module.exports.luaC_freeallobjects = luaC_freeallobjects;
module.exports.luaC_fullgc         = luaC_fullgc;
module.exports.luaC_step           = luaC_step;
