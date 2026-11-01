"use strict";

/*
** Collector support for weak tables, finalizers and memory accounting.
**
** JavaScript's collector cannot observe Lua liveness synchronously, so
** Fengari runs a mark/sweep over the Lua object graph:
**   - weak keys/values are not traversed as strong edges,
**   - ephemeron tables (weak keys, strong values) are iterated to a fixpoint,
**   - entries whose weak side is unreachable are removed,
**   - unreachable objects marked with __gc are finalized once.
**
** A full cycle (collect, automatic collection, state close) is atomic.
** collectgarbage("step") marks incrementally: the work list is processed in
** bounded batches, roots/upvalues/hilo stacks are re-scanned between steps and
** table/metatable/uservalue writes go through a write barrier. Only the final
** ephemeron fixpoint is atomic. Objects must be anchored in the Lua state
** (stack, registry, upvalue, table) to count as reachable, like C pointers.
*/

const {
    constant_types: { LUA_TTABLE, LUA_TUSERDATA },
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
const MARK_INFINITY = Infinity;

/* rough per-object sizes, used only by collectgarbage("count") */
const TVALUE_SIZE      = 16;
const TABLE_OVERHEAD   = 56;
const ENTRY_SIZE       = 40;
const CLOSURE_OVERHEAD = 40;
const UDATA_OVERHEAD   = 32;
const STRING_OVERHEAD  = 24;
const THREAD_OVERHEAD  = 120;
const CALLINFO_SIZE    = 80;
const PROTO_OVERHEAD   = 96;

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
        return TABLE_OVERHEAD + (o.strong.size + o.dead_strong.size) * ENTRY_SIZE;
    if (o instanceof lobject.Udata)
        return UDATA_OVERHEAD + o.len;
    if (o instanceof lobject.LClosure)
        return CLOSURE_OVERHEAD + o.nupvalues * TVALUE_SIZE;
    if (o instanceof lobject.CClosure)
        return CLOSURE_OVERHEAD + o.nupvalues * TVALUE_SIZE;
    if (o instanceof lstate.lua_State) {
        let cis = 0;
        for (let ci = o.base_ci; ci; ci = ci.next) cis++;
        return THREAD_OVERHEAD + (o.stack ? o.stack.length * TVALUE_SIZE : 0) +
            cis * CALLINFO_SIZE;
    }
    if (o instanceof lfunc.Proto)
        return PROTO_OVERHEAD + o.code.length * 4 + o.k.length * TVALUE_SIZE +
            o.p.length * 8 + o.lineinfo.length * 4 + o.upvalues.length * 8 +
            o.locvars.length * 24;
    return 0;
};

/*
** Build a marking context. include_strings also records strings reachable
** from live values (for memory accounting); strings are never weak-collected.
*/
const create_context = function(L, include_strings) {
    const g = L.l_G;
    const ctx = {
        marked: new Set(),
        strings: include_strings ? new Set() : null,
        work: [],
        modes: new Map(),
        weak_tables: [],
        weak_seen: new Set(),
        ephemerons: [],
        closures: [],
        threads: [],
        udatas: [],
        weak_index: 0,
        weak_iter: null,
        finalize: [],
        finalize_index: 0,
        phase: "mark"
    };

    const mark_string = function(s) {
        if (ctx.strings && s)
            ctx.strings.add(s);
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
            mark_string(tv.value);
            return;
        }
        if (iscollectable(tv))
            mark_object(tv.value);
    };

    const is_alive = function(tv) {
        return !iscollectable(tv) || ctx.marked.has(tv.value);
    };

    const closure_refs = function(f) {
        mark_object(f.p);
        for (const up of f.upvals || []) {
            if (up) mark_tvalue(up);
        }
        for (const up of f.upvalue || []) {
            if (up) mark_tvalue(up);
        }
    };

    const udata_refs = function(u) {
        mark_table(u.metatable);
        mark_tvalue(u.uservalue);
    };

    const thread_refs = function(L1) {
        if (L1.stack) {
            for (let i = 0; i < L1.top; i++) {
                const tv = L1.stack[i];
                if (tv) mark_tvalue(tv);
            }
        }
        for (let ci = L1.ci; ci; ci = ci.previous)
            if (ci.func) mark_tvalue(ci.func);
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

    const traverse_proto = function(p) {
        for (const tv of p.k)
            mark_tvalue(tv);
        for (const sub of p.p)
            mark_object(sub);
        if (p.cache)
            mark_object(p.cache);
        if (ctx.strings) {
            mark_string(p.source);
            for (const uv of p.upvalues)
                if (uv.name) mark_string(uv.name);
            for (const lv of p.locvars)
                if (lv.varname) mark_string(lv.varname);
        }
    };

    const drain = function(budget) {
        let processed = 0;
        while (ctx.work.length > 0 && processed < budget) {
            const o = ctx.work.pop();
            processed++;
            if (o instanceof ltable.Table)
                traverse_table(o);
            else if (o instanceof lobject.Udata) {
                ctx.udatas.push(o);
                udata_refs(o);
            } else if (o instanceof lobject.LClosure) {
                ctx.closures.push(o);
                closure_refs(o);
            } else if (o instanceof lobject.CClosure) {
                ctx.closures.push(o);
                closure_refs(o);
            } else if (o instanceof lstate.lua_State) {
                ctx.threads.push(o);
                thread_refs(o);
            } else if (o instanceof lfunc.Proto)
                traverse_proto(o);
        }
        return processed;
    };

    const drain_ephemerons_atomic = function() {
        let previous;
        do {
            previous = ctx.marked.size;
            for (const t of ctx.ephemerons) {
                for (const entry of t.strong.values()) {
                    if (is_alive(entry.key))
                        mark_tvalue(entry.value);
                }
            }
            drain(MARK_INFINITY);
        } while (ctx.marked.size !== previous);
    };

    const mark_roots = function() {
        mark_object(L);
        mark_object(g.mainthread);
        mark_tvalue(g.l_registry);
        for (const mt of g.mt)
            mark_table(mt);
        if (ctx.strings) {
            for (const s of g.tmname)
                if (s) mark_string(s);
        }
    };

    const finish_sweep_start = function() {
        ctx.finalize = [];
        for (const obj of g.finalizable) {
            if (!ctx.marked.has(obj))
                ctx.finalize.push(obj);
        }
        ctx.finalize.reverse();
        ctx.phase = "sweep";
    };

    const start_ephemerons = function() {
        ctx.phase = "ephemeron";
        ctx.eph_index = 0;
        ctx.eph_iter = null;
        ctx.eph_before = ctx.marked.size;
    };

    const ephemeron_step = function(budget) {
        let used = 0;
        while (used < budget && ctx.eph_index < ctx.ephemerons.length) {
            const t = ctx.ephemerons[ctx.eph_index];
            if (!ctx.eph_iter)
                ctx.eph_iter = t.strong.entries();
            const next = ctx.eph_iter.next();
            if (next.done) {
                ctx.eph_iter = null;
                ctx.eph_index++;
                continue;
            }
            const entry = next.value[1];
            if (is_alive(entry.key) &&
                iscollectable(entry.value) &&
                !ctx.marked.has(entry.value.value))
                mark_tvalue(entry.value);
            used++;
            used += drain(budget - used);
        }
        return {
            used,
            done: ctx.eph_index >= ctx.ephemerons.length
        };
    };

    ctx.mark_object = mark_object;
    ctx.mark_tvalue = mark_tvalue;
    ctx.drain = drain;
    ctx.drain_ephemerons_atomic = drain_ephemerons_atomic;
    ctx.finish_sweep_start = finish_sweep_start;
    ctx.start_ephemerons = start_ephemerons;
    ctx.ephemeron_step = ephemeron_step;
    ctx.barrier = function(tv) {
        mark_tvalue(tv);
    };
    /* Re-scan mutable roots between incremental steps (without draining the
       pending work list, so marking stays bounded). */
    ctx.rescan = function() {
        mark_roots();
        for (let i = 0; i < ctx.closures.length; i++)
            closure_refs(ctx.closures[i]);
        for (let i = 0; i < ctx.threads.length; i++)
            thread_refs(ctx.threads[i]);
        for (let i = 0; i < ctx.udatas.length; i++)
            udata_refs(ctx.udatas[i]);
    };
    /* Full re-scan for the sweep phase: the delta must be marked before any
       further entry is cleared. */
    ctx.remark = function() {
        ctx.rescan();
        drain(MARK_INFINITY);
        drain_ephemerons_atomic();
    };

    mark_roots();
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
        ctx = create_context(L, false);
        ctx.drain(MARK_INFINITY);
        ctx.drain_ephemerons_atomic();
        ctx.finish_sweep_start();
        clear_weak_entries(ctx);
        run_pending_finalizers(L, ctx, true);
    } finally {
        if (ctx) reset_threshold(L, ctx);
        g.in_gc = false;
    }
};

/*
** Incremental cycle: bounded marking, then bounded weak-clearing and
** finalization. Returns true when the cycle is complete.
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
            ctx = create_context(L, false);
            g.gc_ctx = ctx;
        } else if (ctx.phase === "mark") {
            ctx.rescan();
        } else {
            ctx.remark();
        }

        let budget = Math.max(10, g.gc_stepmul|0);

        if (ctx.phase === "mark") {
            budget -= ctx.drain(budget);
            if (ctx.work.length > 0)
                return false;
            ctx.start_ephemerons();
        }

        if (ctx.phase === "ephemeron") {
            const res = ctx.ephemeron_step(Math.max(1, budget));
            budget -= res.used;
            if (!res.done)
                return false;
            if (ctx.marked.size !== ctx.eph_before) {
                ctx.start_ephemerons();  /* another pass may mark more values */
                return false;
            }
            ctx.finish_sweep_start();
        }

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

        if (ctx.phase === "sweep" &&
            ctx.weak_index >= ctx.weak_tables.length &&
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

/* Write barrier used while an incremental cycle is active. */
const luaC_barrier = function(g, tv) {
    const ctx = g.gc_ctx;
    if (ctx)
        ctx.barrier(tv);
};

const luaC_barrier_object = function(g, o) {
    const ctx = g.gc_ctx;
    if (ctx && o)
        ctx.mark_object(o);
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

    const ctx = create_context(L, true);
    ctx.drain(MARK_INFINITY);
    ctx.drain_ephemerons_atomic();
    ctx.finish_sweep_start();
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
    const ldo = require('./ldo.js');
    if (!lapi.lua_checkstack(L, 2))
        return;

    const top = L.top;
    L.stack[L.top++] = new lobject.TValue(tm.type, tm.value);
    L.stack[L.top++] = new lobject.TValue(
        obj instanceof ltable.Table ? LUA_TTABLE : LUA_TUSERDATA, obj);

    /* same path as PUC's GCTM: call the finalizer without an extra frame */
    const dothecall = function(L1) {
        ldo.luaD_callnoyield(L1, L1.top - 2, 0);
    };
    const status = ldo.luaD_pcall(L, dothecall, null, top, 0);
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

module.exports.luaC_allocated       = luaC_allocated;
module.exports.luaC_barrier         = luaC_barrier;
module.exports.luaC_barrier_object  = luaC_barrier_object;
module.exports.luaC_checkfinalizer  = luaC_checkfinalizer;
module.exports.luaC_count           = luaC_count;
module.exports.luaC_freeallobjects  = luaC_freeallobjects;
module.exports.luaC_fullgc          = luaC_fullgc;
module.exports.luaC_step            = luaC_step;
