"use strict";

/*
** Native PUC Lua 5.1/5.2 binary chunk loader.
** The chunks are translated to Fengari's internal 5.3 opcode layout so the
** existing VM can execute them. 5.2 is a direct opcode remap; 5.1 also
** rewrites GETGLOBAL/SETGLOBAL to GETTABUP/SETTABUP with a synthetic _ENV
** upvalue, consumes CLOSURE upvalue descriptors and expands TFORLOOP.
*/

const {
    LUA_ERRSYNTAX,
    constant_types: {
        LUA_TBOOLEAN,
        LUA_TLNGSTR,
        LUA_TNIL,
        LUA_TNUMFLT
    },
    to_luastring
} = require('./defs.js');
const lfunc   = require('./lfunc.js');
const lobject = require('./lobject.js');
const lopcodes = require('./lopcodes.js');
const { luaS_new } = require('./lstring.js');
const { EOZ } = require('./lzio.js');

const OPS52 = [
    "MOVE", "LOADK", "LOADKX", "LOADBOOL", "LOADNIL", "GETUPVAL",
    "GETTABUP", "GETTABLE", "SETTABUP", "SETUPVAL", "SETTABLE",
    "NEWTABLE", "SELF", "ADD", "SUB", "MUL", "DIV", "MOD", "POW",
    "UNM", "NOT", "LEN", "CONCAT", "JMP", "EQ", "LT", "LE",
    "TEST", "TESTSET", "CALL", "TAILCALL", "RETURN", "FORLOOP",
    "FORPREP", "TFORCALL", "TFORLOOP", "SETLIST", "CLOSURE",
    "VARARG", "EXTRAARG"
];

const OPS51 = [
    "MOVE", "LOADK", "LOADBOOL", "LOADNIL", "GETUPVAL", "GETGLOBAL",
    "GETTABLE", "SETGLOBAL", "SETUPVAL", "SETTABLE", "NEWTABLE",
    "SELF", "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "UNM",
    "NOT", "LEN", "CONCAT", "JMP", "EQ", "LT", "LE", "TEST",
    "TESTSET", "CALL", "TAILCALL", "RETURN", "FORLOOP", "FORPREP",
    "TFORLOOP", "SETLIST", "CLOSE", "CLOSURE", "VARARG"
];

const OP = function(name) {
    let op = lopcodes.OpCodesI["OP_" + name];
    if (op === undefined)
        throw new Error("missing translated opcode " + name);
    return op;
};

class Reader {
    constructor(L, Z, version) {
        this.L = L;
        this.Z = Z;
        this.version = version;
        this.intSize = 4;
        this.sizeTSize = 8;
        this.instrSize = 4;
        this.numberSize = 8;
        this.integral = false;
        this.buf = new ArrayBuffer(8);
        this.dv = new DataView(this.buf);
        this.u8 = new Uint8Array(this.buf);
    }

    error(message) {
        lobject.luaO_pushfstring(this.L, to_luastring("%s: %s precompiled chunk"),
            to_luastring("native"), to_luastring(message));
        require('./ldo.js').luaD_throw(this.L, LUA_ERRSYNTAX);
    }

    byte() {
        let c = this.Z.zgetc();
        if (c === EOZ) this.error("truncated");
        return c & 0xff;
    }

    take(n) {
        let out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = this.byte();
        return out;
    }

    uint(n) {
        let v = 0;
        for (let i = 0; i < n; i++) v += this.byte() * Math.pow(2, i * 8);
        return v;
    }

    int() { return this.uint(4); }
    size_t() { return this.uint(this.sizeTSize); }

    number() {
        let b = this.take(this.numberSize);
        for (let i = 0; i < b.length; i++) this.u8[i] = b[i];
        return this.dv.getFloat64(0, true);
    }

    string() {
        let size = this.size_t();
        if (size === 0) return null;
        let bytes = this.take(size);
        return luaS_new(this.L, bytes.subarray(0, size - 1));
    }

    header() {
        if (this.byte() !== 76 || this.byte() !== 117 || this.byte() !== 97)
            this.error("not a");
        if (this.byte() !== this.version)
            this.error("version mismatch in");
        if (this.byte() !== 0)
            this.error("format mismatch in");
        if (this.byte() !== 1)
            this.error("endianness mismatch in");
        this.intSize = this.byte();
        this.sizeTSize = this.byte();
        this.instrSize = this.byte();
        let numberSize = this.byte();
        this.numberSize = numberSize;
        this.integral = this.byte() !== 0;
        if (this.version === 0x52)
            this.take(6);  /* LUAC_TAIL */
        if (this.intSize !== 4 || this.instrSize !== 4 ||
            this.numberSize !== 8 || this.integral)
            this.error("incompatible");
    }

    vectorInt() {
        let n = this.int();
        let out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.int();
        return out;
    }

    constant() {
        let t = this.byte();
        switch (t) {
            case LUA_TNIL:
                return new lobject.TValue(LUA_TNIL, null);
            case LUA_TBOOLEAN:
                return new lobject.TValue(LUA_TBOOLEAN, this.byte() !== 0);
            case 3:  /* LUA_TNUMBER */
                return new lobject.TValue(LUA_TNUMFLT, this.number());
            case 4: {  /* LUA_TSTRING */
                let ts = this.string();
                return new lobject.TValue(LUA_TLNGSTR, ts);
            }
            default:
                this.error("bad constant type");
        }
    }

    constants() {
        let n = this.int();
        let out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.constant();
        return out;
    }

    debug(f) {
        if (this.version === 0x52)
            f.source = this.string();
        let nline = this.int();
        for (let i = 0; i < nline; i++) f.lineinfo[i] = this.int();
        let nloc = this.int();
        for (let i = 0; i < nloc; i++) {
            let v = new lobject.LocVar();
            v.varname = this.string();
            v.startpc = this.int();
            v.endpc = this.int();
            f.locvars[i] = v;
        }
        let nup = this.int();
        for (let i = 0; i < nup && i < f.upvalues.length; i++)
            f.upvalues[i].name = this.string();
    }
}

const remap52 = function(raws) {
    let out = new Array(raws.length);
    for (let i = 0; i < raws.length; i++) {
        let ins = lopcodes.fullins(raws[i]);
        let name = OPS52[ins.opcode];
        if (name === undefined) throw new Error("unknown 5.2 opcode " + ins.opcode);
        out[i] = lopcodes.fullins((raws[i] & ~0x3f) | OP(name));
    }
    return out;
};

const remap51 = function(f, raws, protos, envIndex) {
    let out = [];
    let map = new Array(raws.length + 1);
    let records = [];
    let pc = 0;
    const emit = function(ins, oldpc, target) {
        records.push({ins: ins, oldpc: oldpc,
            target: target === undefined ? null : target});
        out.push(ins);
    };
    while (pc < raws.length) {
        map[pc] = out.length;
        let raw = raws[pc];
        let ins = lopcodes.fullins(raw);
        let name = OPS51[ins.opcode];
        if (name === undefined) throw new Error("unknown 5.1 opcode " + ins.opcode);

        if (name === "CLOSURE") {
            let child = protos[ins.Bx];
            let nup = child.native_nups;
            let desc = [];
            for (let j = 0; j < nup; j++) {
                let d = lopcodes.fullins(raws[pc + 1 + j]);
                desc.push({
                    instack: d.opcode === OP("MOVE"),
                    idx: d.B,
                    name: null
                });
                map[pc + 1 + j] = out.length;
            }
            desc.push({instack: false, idx: envIndex, name: null});
            child.upvalues = desc;
            emit(lopcodes.CREATE_ABx(OP("CLOSURE"), ins.A, ins.Bx), pc);
            pc += 1 + nup;
            continue;
        }

        if (name === "TFORLOOP") {
            emit(lopcodes.CREATE_ABC(OP("TFORCALL"), ins.A, 0, ins.C), pc);
            let jmp = lopcodes.fullins(raws[pc + 1]);
            map[pc + 1] = out.length;
            emit(lopcodes.CREATE_ABx(OP("TFORLOOP"), ins.A + 2, 0), pc + 1,
                pc + 2 + jmp.sBx);
            pc += 2;
            continue;
        }

        if (name === "SETLIST" && ins.C === 0) {
            /* 5.1 stores the large block number as a bare word, 5.3 wants
               an EXTRAARG instruction carrying it in Ax. */
            emit(lopcodes.CREATE_ABC(OP("SETLIST"), ins.A, ins.B, 0), pc);
            map[pc + 1] = out.length;
            emit(lopcodes.CREATE_Ax(OP("EXTRAARG"), raws[pc + 1]), pc + 1);
            pc += 2;
            continue;
        }

        if (name === "GETGLOBAL") {
            emit(lopcodes.CREATE_ABC(OP("GETTABUP"), ins.A, envIndex,
                lopcodes.RKASK(ins.Bx)), pc);
        } else if (name === "SETGLOBAL") {
            emit(lopcodes.CREATE_ABC(OP("SETTABUP"), envIndex,
                lopcodes.RKASK(ins.Bx), ins.A), pc);
        } else {
            let code = (raw & ~0x3f) | OP(name);
            if (name === "VARARG" && ins.B !== 0)
                code = lopcodes.SETARG_B(lopcodes.fullins(code), ins.B + 1).code;
            let target = null;
            if (name === "JMP" || name === "FORLOOP" || name === "FORPREP")
                target = pc + 1 + ins.sBx;
            emit(lopcodes.fullins(code), pc, target);
        }
        pc++;
    }
    map[raws.length] = out.length;

    for (let i = 0; i < records.length; i++) {
        let rec = records[i];
        if (rec.target === null) continue;
        let newtarget = map[rec.target];
        if (newtarget === undefined) newtarget = out.length;
        let newpc = map[rec.oldpc];
        let sBx = newtarget - (newpc + 1);
        lopcodes.SETARG_sBx(rec.ins, sBx);
    }
    return out;
};

const loadProto = function(R, is51) {
    let f = new lfunc.Proto(R.L);
    let nups = 0;
    if (is51) {
        f.source = R.string();
        f.linedefined = R.int();
        f.lastlinedefined = R.int();
        nups = R.byte();
        f.numparams = R.byte();
        f.is_vararg = R.byte() !== 0;
        f.maxstacksize = R.byte();
        f.native_nups = nups;
    } else {
        f.linedefined = R.int();
        f.lastlinedefined = R.int();
        f.numparams = R.byte();
        f.is_vararg = R.byte() !== 0;
        f.maxstacksize = R.byte();
    }
    let code = R.vectorInt();
    f.k = R.constants();
    let np = R.int();
    let protos = new Array(np);
    for (let i = 0; i < np; i++)
        protos[i] = loadProto(R, is51);
    f.p = protos;

    if (is51) {
        f.upvalues = new Array(nups + 1);
        for (let i = 0; i < nups; i++)
            f.upvalues[i] = {instack: false, idx: 0, name: null};
        f.upvalues[nups] = {instack: false, idx: 0, name: null};
    } else {
        let nup = R.int();
        f.upvalues = new Array(nup);
        for (let i = 0; i < nup; i++) {
            f.upvalues[i] = {
                instack: R.byte() !== 0,
                idx: R.byte(),
                name: null
            };
        }
    }
    R.debug(f);
    f.source = f.source || null;
    f.code = is51 ? remap51(f, code, protos, nups) : remap52(code);
    return f;
};

const luaU_undump_native = function(L, Z, name, version) {
    if (version !== 0x50 + (L.l_G.version % 100)) {
        lobject.luaO_pushfstring(L,
            to_luastring("version mismatch in precompiled chunk"));
        require('./ldo.js').luaD_throw(L, LUA_ERRSYNTAX);
    }
    let R = new Reader(L, Z, version);
    R.header();
    let f = loadProto(R, version === 0x51);
    let cl = lfunc.luaF_newLclosure(L, f.upvalues.length);
    cl.p = f;
    const ldo = require('./ldo.js');
    ldo.luaD_inctop(L);
    L.stack[L.top-1].setclLvalue(cl);
    return cl;
};

module.exports.luaU_undump_native = luaU_undump_native;
