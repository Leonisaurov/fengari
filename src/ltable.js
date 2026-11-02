"use strict";

const {
    constant_types: {
        LUA_TBOOLEAN,
        LUA_TCCL,
        LUA_TLCF,
        LUA_TLCL,
        LUA_TLIGHTUSERDATA,
        LUA_TLNGSTR,
        LUA_TNIL,
        LUA_TNUMFLT,
        LUA_TNUMINT,
        LUA_TSHRSTR,
        LUA_TTABLE,
        LUA_TTHREAD,
        LUA_TUSERDATA
    },
    to_luastring
} = require('./defs.js');
const {
    LUA_INT64,
    LUA_MAXINTEGER
} = require('./luaconf.js');
const { lua_assert } = require('./llimits.js');
const ldebug  = require('./ldebug.js');
const lobject = require('./lobject.js');
const {
    luaS_hashlongstr,
    TString
} = require('./lstring.js');
const lstate  = require('./lstate.js');

/* used to prevent conflicts with lightuserdata keys */
let lightuserdata_hashes = new WeakMap();
let lgc; /* required lazily to avoid a cycle with lgc.js */

const barrier = function(g, tv) {
    if (!g || !g.gc_ctx)
        return;
    if (!lgc) lgc = require('./lgc.js');
    lgc.luaC_barrier(g, tv);
};
const get_lightuserdata_hash = function(v) {
    let hash = lightuserdata_hashes.get(v);
    if (!hash) {
        /* Hash should be something unique that is a valid WeakMap key
           so that it ends up in dead_weak when removed from a table */
        hash = {};
        lightuserdata_hashes.set(v, hash);
    }
    return hash;
};

const table_hash = function(L, key) {
    switch(key.type) {
        case LUA_TNIL:
            return ldebug.luaG_runerror(L, to_luastring("table index is nil", true));
        case LUA_TNUMFLT:
            if (isNaN(key.value))
                return ldebug.luaG_runerror(L, to_luastring("table index is NaN", true));
            /* fall through */
        case LUA_TNUMINT: /* takes advantage of floats and integers being same in JS */
        case LUA_TBOOLEAN:
        case LUA_TTABLE:
        case LUA_TLCL:
        case LUA_TLCF:
        case LUA_TCCL:
        case LUA_TUSERDATA:
        case LUA_TTHREAD:
            return key.value;
        case LUA_TSHRSTR:
        case LUA_TLNGSTR:
            return luaS_hashlongstr(key.tsvalue());
        case LUA_TLIGHTUSERDATA: {
            let v = key.value;
            switch(typeof v) {
                case "string":
                    /* possible conflict with LUA_TSTRING.
                       prefix this string with "*" so they don't clash */
                    return "*" + v;
                case "number":
                    /* possible conflict with LUA_TNUMBER.
                       turn into string and prefix with "#" to avoid clash with other strings */
                    return "#" + v;
                case "bigint":
                    return "#i" + v.toString();
                case "boolean":
                    /* possible conflict with LUA_TBOOLEAN. use strings ?true and ?false instead */
                    return v?"?true":"?false";
                case "function":
                    /* possible conflict with LUA_TLCF.
                       indirect via a weakmap */
                    return get_lightuserdata_hash(v);
                case "object":
                    /* v could be a lua_State, CClosure, LClosure, Table or Userdata from this state as returned by lua_topointer */
                    if ((v instanceof lstate.lua_State && v.l_G === L.l_G) ||
                        v instanceof Table ||
                        v instanceof lobject.Udata ||
                        v instanceof lobject.LClosure ||
                        v instanceof lobject.CClosure) {
                        /* indirect via a weakmap */
                        return get_lightuserdata_hash(v);
                    }
                    /* fall through */
                default:
                    return v;
            }
        }
        default:
            throw new Error("unknown key type: " + key.type);
    }
};

class Table {
    constructor(L) {
        this.id = L.l_G.id_counter++;
        this.strong = new Map();
        this.dead_strong = new Map();
        this.dead_weak = void 0; /* initialised when needed */
        this.f = void 0; /* first entry */
        this.l = void 0; /* last entry */
        this.metatable = null;
        this.flags = ~0;
        this.finalized = false; /* marked for finalization already? */
        this.g = L.l_G;         /* for write barriers in luaH_setint */
        /* PUC-compatible sizing metadata, used by T.querytab in the tests. */
        this.puc_alimit = 0;
        this.puc_hsize = 0;
        this.puc_hused = 0;
    }
}

const invalidateTMcache = function(t) {
    t.flags = 0;
};

const add = function(t, hash, key, value) {
    t.dead_strong.clear();
    t.dead_weak = void 0;
    let prev = null;
    let entry = {
        key: key,
        value: value,
        p: prev = t.l,
        n: void 0
    };
    if (!t.f) t.f = entry;
    if (prev) prev.n = entry;
    t.strong.set(hash, entry);
    t.l = entry;
};

const is_valid_weakmap_key = function(k) {
    return typeof k === 'object' ? k !== null : typeof k === 'function';
};

/* Move out of 'strong' part and into 'dead' part. */
const mark_dead = function(t, hash) {
    let e = t.strong.get(hash);
    if (e) {
        e.key.setdeadvalue();
        e.value = void 0;
        let next = e.n;
        let prev = e.p;
        e.p = void 0; /* no need to know previous item any more */
        if(prev) prev.n = next;
        if(next) next.p = prev;
        if(t.f === e) t.f = next;
        if(t.l === e) t.l = prev;
        t.strong.delete(hash);
        if (is_valid_weakmap_key(hash)) {
            if (!t.dead_weak) t.dead_weak = new WeakMap();
            t.dead_weak.set(hash, e);
        } else {
            /* can't be used as key in weakmap */
            t.dead_strong.set(hash, e);
        }
    }
};

/* Remove an entry that the collector found dead. Unlike mark_dead, this does
   not keep the key around for a later 'next' call. */
const luaH_removeentry = function(t, hash, e) {
    if (e.p) e.p.n = e.n;
    else t.f = e.n;
    if (e.n) e.n.p = e.p;
    else t.l = e.p;
    e.p = void 0;
    e.n = void 0;
    e.key.setdeadvalue();
    e.value = void 0;
    t.strong.delete(hash);
};

const luaH_new = function(L) {
    const t = new Table(L);
    if (!lgc) lgc = require('./lgc.js');
    lgc.luaC_allocated(L, t);
    return t;
};

/* ------------------------------------------------------------------------ */
/* PUC-compatible array/hash sizing simulation (T.querytab in ltests.js)    */
/* ------------------------------------------------------------------------ */

const PUC_MAXASIZE = 0x7fffffff;

const puc_ceillog2 = function(n) {
    return Math.max(0, Math.ceil(Math.log2(n)));
};

const puc_nextpow2 = function(n) {
    if (n <= 0)
        return 0;
    let p = 1;
    while (p < n)
        p *= 2;
    return p;
};

const puc_intkey = function(key) {
    if (typeof key === "number")
        return Number.isInteger(key) ? key : null;
    if (typeof key === "bigint")
        return Number(key);
    if (key instanceof lobject.TValue) {
        if (key.ttisinteger())
            return Number(key.value);
        if (key.ttisfloat() && Number.isInteger(key.value))
            return key.value;
    }
    return null;
};

const puc_countint = function(k, nums) {
    if (k >= 1 && k <= PUC_MAXASIZE) {
        let lg = puc_ceillog2(k);
        nums[lg] = (nums[lg] || 0) + 1;
        return 1;
    }
    return 0;
};

const puc_rehash = function(t, extra) {
    let nums = [];
    let na = 0;
    let total = 0;
    for (const e of t.strong.values()) {
        total++;
        let k = puc_intkey(e.key);
        if (k !== null)
            na += puc_countint(k, nums);
    }
    if (extra !== undefined) {
        total++;
        if (extra !== null)
            na += puc_countint(extra, nums);
    }
    let a = 0;
    let nakept = 0;
    let optimal = 0;
    let twotoi = 1;
    for (let i = 0; twotoi > 0 && na > twotoi / 2; i++, twotoi *= 2) {
        a += nums[i] || 0;
        if (a > twotoi / 2) {
            optimal = twotoi;
            nakept = a;
        }
    }
    t.puc_alimit = optimal;
    t.puc_hsize = puc_nextpow2(total - nakept);
    t.puc_hused = total - nakept;
};

const puc_newkey = function(t, k) {
    if (k !== null && k >= 1 && k <= t.puc_alimit)
        return;
    if (t.puc_hsize === 0 || t.puc_hused >= t.puc_hsize) {
        puc_rehash(t, k);
        if (k !== null && k >= 1 && k <= t.puc_alimit)
            return;
    } else
        t.puc_hused++;
};

const puc_resize = function(t, na, nh) {
    t.puc_alimit = na;
    t.puc_hsize = puc_nextpow2(nh);
    let used = 0;
    for (const e of t.strong.values()) {
        let k = puc_intkey(e.key);
        if (k === null || k < 1 || k > na)
            used++;
    }
    t.puc_hused = used;
};

const puc_resizearray = function(t, na) {
    t.puc_alimit = na;
    let used = 0;
    for (const e of t.strong.values()) {
        let k = puc_intkey(e.key);
        if (k === null || k < 1 || k > na)
            used++;
    }
    t.puc_hused = used;
};

const getgeneric = function(t, hash) {
    let v = t.strong.get(hash);
    return v ? v.value : lobject.luaO_nilobject;
};

const luaH_getint = function(t, key) {
    if (LUA_INT64 && typeof key === "number")
        key = BigInt(key);
    lua_assert(typeof key == "bigint" || (typeof key == "number" && (key|0) === key));
    return getgeneric(t, key);
};

const luaH_getstr = function(t, key) {
    lua_assert(key instanceof TString);
    return getgeneric(t, luaS_hashlongstr(key));
};

const luaH_get = function(L, t, key) {
    lua_assert(key instanceof lobject.TValue);
    if (key.ttisnil() || (key.ttisfloat() && isNaN(key.value)))
        return lobject.luaO_nilobject;
    return getgeneric(t, table_hash(L, key));
};

const luaH_setint = function(t, key, value) {
    if (LUA_INT64 && typeof key === "number")
        key = BigInt(key);
    lua_assert((typeof key == "bigint" ||
        (typeof key == "number" && (key|0) === key)) &&
        value instanceof lobject.TValue);
    let hash = key; /* table_hash known result */
    if (value.ttisnil()) {
        mark_dead(t, hash);
        return;
    }
    if (t.g && t.g.gc_ctx)
        barrier(t.g, value);
    let e = t.strong.get(hash);
    if (e) {
        let tv = e.value;
        tv.setfrom(value);
    } else {
        puc_newkey(t, puc_intkey(key));
        let k = new lobject.TValue(LUA_TNUMINT, key);
        let v = new lobject.TValue(value.type, value.value);
        add(t, hash, k, v);
    }
};

const luaH_setfrom = function(L, t, key, value) {
    lua_assert(key instanceof lobject.TValue);
    let hash = table_hash(L, key);
    if (value.ttisnil()) { /* delete */
        mark_dead(t, hash);
        return;
    }
    if (t.g && t.g.gc_ctx) {
        barrier(t.g, key);
        barrier(t.g, value);
    }

    let e = t.strong.get(hash);
    if (e) {
        e.value.setfrom(value);
    } else {
        puc_newkey(t, puc_intkey(key));
        let k;
        let kv = key.value;
        if (typeof kv === "bigint") {
            k = new lobject.TValue(LUA_TNUMINT, kv);
        } else if ((key.ttisfloat() && (kv|0) === kv)) { /* does index fit in an integer? */
            /* insert it as an integer */
            k = new lobject.TValue(LUA_TNUMINT, kv);
        } else {
            k = new lobject.TValue(key.type, kv);
        }
        let v = new lobject.TValue(value.type, value.value);
        add(t, hash, k, v);
    }
};

/*
** Try to find a boundary in table 't'. A 'boundary' is an integer index
** such that t[i] is non-nil and t[i+1] is nil (and 0 if t[1] is nil).
*/
const luaH_getn = function(t) {
    let i = 0;
    let j = t.strong.size + 1; /* use known size of Map to kick start search */
    let maxindex = LUA_INT64 ? Number.MAX_SAFE_INTEGER : LUA_MAXINTEGER;
    /* find 'i' and 'j' such that i is present and j is not */
    while (!(luaH_getint(t, j).ttisnil())) {
        i = j;
        if (j > maxindex / 2) {  /* overflow? */
            /* table was built with bad purposes: resort to linear search */
            i = 1;
            while (!luaH_getint(t, i).ttisnil()) i++;
            return i - 1;
        }
        j *= 2;
    }
    /* now do a binary search between them */
    while (j - i > 1) {
        let m = Math.floor((i+j)/2);
        if (luaH_getint(t, m).ttisnil()) j = m;
        else i = m;
    }
    return i;
};

const luaH_next = function(L, table, keyI) {
    let keyO = L.stack[keyI];

    let entry;
    if (keyO.type === LUA_TNIL) {
        entry = table.f;
        if (!entry)
            return false;
    } else {
        /* First find current key */
        let hash = table_hash(L, keyO);
        /* Look in main part of table */
        entry = table.strong.get(hash);
        if (entry) {
            entry = entry.n;
            if (!entry)
                return false;
        } else {
            /* Try dead keys */
            entry = (table.dead_weak && table.dead_weak.get(hash)) || table.dead_strong.get(hash);
            if (!entry)
                /* item not in table */
                return ldebug.luaG_runerror(L, to_luastring("invalid key to 'next'"));
            /* Iterate until either out of keys, or until finding a non-dead key */
            do {
                entry = entry.n;
                if (!entry)
                    return false;
            } while (entry.key.ttisdeadkey());
        }
    }
    let k = entry.key;
    let features = L.l_G && L.l_G.impl && L.l_G.impl.features;
    if (k.ttisinteger() && features && features.integers === false) {
        /* Double-only profiles expose integer table keys as floats. */
        let tv = new lobject.TValue();
        lobject.luaO_setint(L, tv, k.value);
        lobject.setobj2s(L, keyI, tv);
    } else
        lobject.setobj2s(L, keyI, k);
    lobject.setobj2s(L, keyI+1, entry.value);
    return true;
};

module.exports.invalidateTMcache = invalidateTMcache;
module.exports.luaH_get     = luaH_get;
module.exports.luaH_getint  = luaH_getint;
module.exports.luaH_getn    = luaH_getn;
module.exports.luaH_getstr  = luaH_getstr;
module.exports.luaH_setfrom = luaH_setfrom;
module.exports.luaH_setint  = luaH_setint;
module.exports.luaH_new     = luaH_new;
module.exports.luaH_next    = luaH_next;
module.exports.luaH_removeentry = luaH_removeentry;
module.exports.puc_resize    = puc_resize;
module.exports.puc_resizearray = puc_resizearray;
module.exports.Table        = Table;
