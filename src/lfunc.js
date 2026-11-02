"use strict";

const { constant_types: { LUA_TNIL }, to_luastring } = require('./defs.js');
const lobject = require('./lobject.js');

class Proto {
    constructor(L) {
        this.id = L.l_G.id_counter++;
        this.k = [];              // constants used by the function
        this.p = [];              // functions defined inside the function
        this.code = [];           // opcodes
        this.cache = null;        // last-created closure with this prototype
        this.lineinfo = [];       // map from opcodes to source lines (debug information)
        this.upvalues = [];       // upvalue information
        this.numparams = 0;       // number of fixed parameters
        this.is_vararg = false;
        this.maxstacksize = 0;    // number of registers needed by this function
        this.locvars = [];        // information about local variables (debug information)
        this.linedefined = 0;     // debug information
        this.lastlinedefined = 0; // debug information
        this.source = null;       // used for debug information
    }
}

let lgc; /* required lazily to avoid a cycle with lgc.js */

const luaF_newLclosure = function(L, n) {
    const f = new lobject.LClosure(L, n);
    if (!lgc) lgc = require('./lgc.js');
    lgc.luaC_allocated(L);
    return f;
};


const luaF_findupval = function(L, level) {
    return L.stack[level];
};

const luaF_close = function(L, level, status) {
    /* Create new TValues on stack;
     * any closures will keep referencing old TValues */
    for (let i=level; i<L.top; i++) {
        let old = L.stack[i];
        L.stack[i] = new lobject.TValue(old.type, old.value);
    }

    /* Close pending to-be-closed variables, innermost first. */
    let list = L.tbc_list;
    if (!list || list.length === 0)
        return;
    let ltm = require('./ltm.js');
    let ldo = require('./ldo.js');
    while (list.length > 0 && list[list.length - 1] >= level) {
        let idx = list.pop();
        let obj = L.stack[idx];
        if (obj.ttisnil() || (obj.ttisboolean() && obj.value === false))
            continue;
        let tm = ltm.luaT_gettmbyobj(L, obj, ltm.TMS.TM_CLOSE);
        if (tm.ttisnil())
            continue;  /* checked when the variable was marked */
        let funcpos = L.top;
        ldo.luaD_checkstack(L, 3);
        let err = (status === undefined || status === 0)
            ? lobject.luaO_nilobject
            : L.stack[L.top - 1];
        lobject.pushobj2s(L, tm);
        lobject.pushobj2s(L, obj);
        lobject.pushobj2s(L, err);
        if (status === undefined || status === 0)
            ldo.luaD_call(L, funcpos, 0);
        else
            ldo.luaD_callnoyield(L, funcpos, 0);
        L.top = funcpos;
    }
};

/* mark the variable at 'level' as to-be-closed */
const luaF_newtbcupval = function(L, level, name) {
    let obj = L.stack[level];
    if (obj.ttisnil() || (obj.ttisboolean() && obj.value === false))
        return;  /* false and nil do not need closing */
    let ltm = require('./ltm.js');
    let tm = ltm.luaT_gettmbyobj(L, obj, ltm.TMS.TM_CLOSE);
    if (tm.ttisnil()) {
        let ldebug = require('./ldebug.js');
        let vname = name || to_luastring("?");
        ldebug.luaG_runerror(L,
            to_luastring("variable '%s' got a non-closable value"), vname);
    }
    if (!L.tbc_list)
        L.tbc_list = [];
    L.tbc_list.push(level);
};

/*
** fill a closure with new upvalues
*/
const luaF_initupvals = function(L, cl) {
    for (let i = 0; i < cl.nupvalues; i++)
        cl.upvals[i] = new lobject.TValue(LUA_TNIL, null);
};

/*
** Look for n-th local variable at line 'line' in function 'func'.
** Returns null if not found.
*/
const luaF_getlocalname = function(f, local_number, pc) {
    for (let i = 0; i < f.locvars.length && f.locvars[i].startpc <= pc; i++) {
        if (pc < f.locvars[i].endpc) {  /* is variable active? */
            local_number--;
            if (local_number === 0)
                return f.locvars[i].varname.getstr();
        }
    }
    return null;  /* not found */
};

module.exports.MAXUPVAL          = 255;
module.exports.Proto             = Proto;
module.exports.luaF_findupval    = luaF_findupval;
module.exports.luaF_close        = luaF_close;
module.exports.luaF_newtbcupval  = luaF_newtbcupval;
module.exports.luaF_getlocalname = luaF_getlocalname;
module.exports.luaF_initupvals   = luaF_initupvals;
module.exports.luaF_newLclosure  = luaF_newLclosure;
