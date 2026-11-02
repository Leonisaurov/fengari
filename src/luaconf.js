"use strict";

const conf = (typeof process !== "undefined" && process.env && process.env.FENGARICONF
    ? JSON.parse(process.env.FENGARICONF)
    : {});

const {
    LUA_VERSION_MAJOR,
    LUA_VERSION_MINOR,
    to_luastring
} = require('./defs.js');

/*
** LUA_PATH_SEP is the character that separates templates in a path.
** LUA_PATH_MARK is the string that marks the substitution points in a
** template.
** LUA_EXEC_DIR in a Windows path is replaced by the executable's
** directory.
*/
const LUA_PATH_SEP  = ";";
module.exports.LUA_PATH_SEP = LUA_PATH_SEP;

const LUA_PATH_MARK = "?";
module.exports.LUA_PATH_MARK = LUA_PATH_MARK;

const LUA_EXEC_DIR  = "!";
module.exports.LUA_EXEC_DIR = LUA_EXEC_DIR;

/*
@@ LUA_PATH_DEFAULT is the default path that Lua uses to look for
** Lua libraries.
@@ LUA_JSPATH_DEFAULT is the default path that Lua uses to look for
** JS libraries.
** CHANGE them if your machine has a non-conventional directory
** hierarchy or if you want to install your libraries in
** non-conventional directories.
*/
const LUA_VDIR = LUA_VERSION_MAJOR + "." + LUA_VERSION_MINOR;
module.exports.LUA_VDIR = LUA_VDIR;

if (typeof process === "undefined") {
    const LUA_DIRSEP = "/";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    const LUA_LDIR = "./lua/" + LUA_VDIR + "/";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = LUA_LDIR;
    module.exports.LUA_JSDIR = LUA_JSDIR;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?/init.lua;" +
        /* LUA_JSDIR excluded as it is equal to LUA_LDIR */
        "./?.lua;./?/init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" + LUA_JSDIR + "loadall.js;./?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
} else if (require('os').platform() === 'win32') {
    const LUA_DIRSEP = "\\";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    /*
    ** In Windows, any exclamation mark ('!') in the path is replaced by the
    ** path of the directory of the executable file of the current process.
    */
    const LUA_LDIR = "!\\lua\\";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = "!\\";
    module.exports.LUA_JSDIR = LUA_JSDIR;

    const LUA_SHRDIR = "!\\..\\share\\lua\\" + LUA_VDIR + "\\";
    module.exports.LUA_SHRDIR = LUA_SHRDIR;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?\\init.lua;" +
        LUA_JSDIR + "?.lua;" + LUA_JSDIR + "?\\init.lua;" +
        LUA_SHRDIR + "?.lua;" + LUA_SHRDIR + "?\\init.lua;" +
        ".\\?.lua;.\\?\\init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" +
        LUA_JSDIR + "..\\share\\lua\\" + LUA_VDIR + "\\?.js;" +
        LUA_JSDIR + "loadall.js;.\\?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
} else {
    const LUA_DIRSEP = "/";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    const LUA_ROOT = "/usr/local/";
    module.exports.LUA_ROOT = LUA_ROOT;
    const LUA_ROOT2 = "/usr/";

    const LUA_LDIR = LUA_ROOT + "share/lua/" + LUA_VDIR + "/";
    const LUA_LDIR2 = LUA_ROOT2 + "share/lua/" + LUA_VDIR + "/";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = LUA_LDIR;
    module.exports.LUA_JSDIR = LUA_JSDIR;
    const LUA_JSDIR2 = LUA_LDIR2;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?/init.lua;" +
        LUA_LDIR2 + "?.lua;" + LUA_LDIR2 + "?/init.lua;" +
        /* LUA_JSDIR(2) excluded as it is equal to LUA_LDIR(2) */
        "./?.lua;./?/init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" + LUA_JSDIR + "loadall.js;" +
        LUA_JSDIR2 + "?.js;" + LUA_JSDIR2 + "loadall.js;" +
        "./?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
}

/*
@@ LUA_COMPAT_FLOATSTRING makes Lua format integral floats without a
@@ a float mark ('.0').
** This macro is not on by default even in compatibility mode,
** because this is not really an incompatibility.
*/
const LUA_COMPAT_FLOATSTRING = conf.LUA_COMPAT_FLOATSTRING || false;

const LUA_INT64 = conf.LUA_INT64 === true;

const LUA_MAXINTEGER = LUA_INT64 ? 9223372036854775807n : 2147483647;
const LUA_MININTEGER = LUA_INT64 ? -9223372036854775808n : -2147483648;

/* canonical integer representation for the selected mode */
const lua_int = function(x) {
    if (LUA_INT64)
        return typeof x === "bigint" ? BigInt.asIntN(64, x) : BigInt(x);
    return x | 0;
};

/*
@@ LUAI_MAXSTACK limits the size of the Lua stack.
** CHANGE it if you need a different limit. This limit is arbitrary;
** its only purpose is to stop Lua from consuming unlimited stack
** space (and to reserve some numbers for pseudo-indices).
*/
const LUAI_MAXSTACK = conf.LUAI_MAXSTACK || 1000000;

/*
@@ LUA_IDSIZE gives the maximum size for the description of the source
@@ of a function in debug information.
** CHANGE it if you want a different size.
*/
const LUA_IDSIZE = conf.LUA_IDSIZE || (60-1); /* fengari uses 1 less than lua as we don't embed the null byte */

const lua_integer2str = function(n) {
    return String(n); /* should match behaviour of LUA_INTEGER_FMT */
};

const FLOAT_VIEW = new DataView(new ArrayBuffer(8));
const POW5 = [1n];
const pow5 = function(k) {
    while (POW5.length <= k)
        POW5.push(POW5[POW5.length - 1] * 5n);
    return POW5[k];
};

/* Exact decimal digits and exponent for a finite non-zero Number. */
const exact_decimal = function(n) {
    FLOAT_VIEW.setFloat64(0, n, false);
    let hi = FLOAT_VIEW.getUint32(0, false);
    let lo = FLOAT_VIEW.getUint32(4, false);
    let neg = (hi >>> 31) === 1;
    let expBits = (hi >>> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let exp2;
    if (expBits === 0)
        exp2 = -1074;  /* subnormal */
    else {
        mant |= (1n << 52n);
        exp2 = expBits - 1075;
    }
    if (exp2 >= 0)
        return { neg, digits: (mant << BigInt(exp2)).toString(), exp10: 0 };
    let k = -exp2;
    /* mant / 2^k == (mant * 5^k) / 10^k */
    return { neg, digits: (mant * pow5(k)).toString(), exp10: -k };
};

const lua_number2str = function(n) {
    /* Should match the behaviour of LUA_NUMBER_FMT ("%.14g"). */
    if (Number.isNaN(n)) return "-nan";  /* PUC's x86 arithmetic NaN */
    if (n === Infinity) return "inf";
    if (n === -Infinity) return "-inf";
    if (n === 0) return Object.is(n, -0) ? "-0" : "0";
    /* Fast path: integers with at most 14 significant digits. */
    if (Number.isInteger(n) && Math.abs(n) < 1e14)
        return String(n);

    let { neg, digits, exp10 } = exact_decimal(n);
    let L = digits.length;
    let exp = exp10 + L - 1;  /* exponent of the first digit */
    let kept;
    if (L > 14) {
        kept = digits.slice(0, 14);
        let rest = digits.slice(14);
        let first = rest.charCodeAt(0) - 48;
        let up;
        if (first > 5)
            up = true;
        else if (first < 5)
            up = false;
        else {
            up = false;
            for (let i = 1; i < rest.length; i++) {
                if (rest.charCodeAt(i) !== 48) {
                    up = true;
                    break;
                }
            }
            /* exact tie: round half to even */
            if (!up && ((kept.charCodeAt(13) - 48) & 1) === 1)
                up = true;
        }
        if (up) {
            let arr = kept.split("");
            let i = 13;
            while (i >= 0 && arr[i] === "9") {
                arr[i] = "0";
                i--;
            }
            if (i < 0) {
                kept = "1";
                exp += 1;
            } else {
                arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1);
                kept = arr.join("");
            }
        }
    } else
        kept = digits;
    kept = kept.replace(/0+$/, "");
    if (kept.length === 0)
        kept = "0";

    let s;
    if (exp < -4 || exp >= 14) {  /* scientific notation */
        s = kept[0];
        if (kept.length > 1)
            s += "." + kept.slice(1);
        s += "e" + (exp < 0 ? "-" : "+") +
            String(Math.abs(exp)).padStart(2, "0");
    } else if (exp >= 0) {
        if (kept.length <= exp + 1)
            s = kept + "0".repeat(exp + 1 - kept.length);
        else
            s = kept.slice(0, exp + 1) + "." + kept.slice(exp + 1);
    } else
        s = "0." + "0".repeat(-exp - 1) + kept;

    return (neg ? "-" : "") + s;
};

const lua_numbertointeger = function(n) {
    if (LUA_INT64) {
        return Number.isFinite(n) && Number.isInteger(n) &&
            n >= -9223372036854775808 && n < 9223372036854775808
            ? BigInt(n) : false;
    }
    return n >= LUA_MININTEGER && n < -LUA_MININTEGER ? n : false;
};

const LUA_INTEGER_FRMLEN = "";
const LUA_NUMBER_FRMLEN = "";

const LUA_INTEGER_FMT = `%${LUA_INTEGER_FRMLEN}d`;
const LUA_NUMBER_FMT  = "%.14g";

const lua_getlocaledecpoint = function(L) {
    if (L && L.l_G && L.l_G.locale_decimal)
        return L.l_G.locale_decimal.charCodeAt(0);
    return 46 /* '.'.charCodeAt(0) */;
};

/*
@@ LUAL_BUFFERSIZE is the buffer size used by the lauxlib buffer system.
*/
const LUAL_BUFFERSIZE = conf.LUAL_BUFFERSIZE || 8192;

// See: http://croquetweak.blogspot.fr/2014/08/deconstructing-floats-frexp-and-ldexp.html
const frexp = function(value) {
    if (value === 0) return [value, 0];
    var data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, value);
    var bits = (data.getUint32(0) >>> 20) & 0x7FF;
    if (bits === 0) { // denormal
        data.setFloat64(0, value * Math.pow(2, 64));  // exp + 64
        bits = ((data.getUint32(0) >>> 20) & 0x7FF) - 64;
    }
    var exponent = bits - 1022;
    var mantissa = ldexp(value, -exponent);
    return [mantissa, exponent];
};

const ldexp = function(mantissa, exponent) {
    var steps = Math.min(3, Math.ceil(Math.abs(exponent) / 1023));
    var result = mantissa;
    for (var i = 0; i < steps; i++)
        result *= Math.pow(2, Math.floor((exponent + i) / steps));
    return result;
};

module.exports.LUAI_MAXSTACK          = LUAI_MAXSTACK;
module.exports.LUA_COMPAT_FLOATSTRING = LUA_COMPAT_FLOATSTRING;
module.exports.LUA_IDSIZE             = LUA_IDSIZE;
module.exports.LUA_VERSION            = conf.LUA_VERSION || "5.3";
module.exports.LUA_INT64              = LUA_INT64;
module.exports.LUA_INTEGER_FMT        = LUA_INTEGER_FMT;
module.exports.LUA_INTEGER_FRMLEN     = LUA_INTEGER_FRMLEN;
module.exports.LUA_MAXINTEGER         = LUA_MAXINTEGER;
module.exports.LUA_MININTEGER         = LUA_MININTEGER;
module.exports.LUA_NUMBER_FMT         = LUA_NUMBER_FMT;
module.exports.LUA_NUMBER_FRMLEN      = LUA_NUMBER_FRMLEN;
module.exports.LUAL_BUFFERSIZE        = LUAL_BUFFERSIZE;
module.exports.frexp                  = frexp;
module.exports.ldexp                  = ldexp;
module.exports.lua_getlocaledecpoint  = lua_getlocaledecpoint;
module.exports.lua_integer2str        = lua_integer2str;
module.exports.lua_int                = lua_int;
module.exports.lua_number2str         = lua_number2str;
module.exports.lua_numbertointeger    = lua_numbertointeger;
