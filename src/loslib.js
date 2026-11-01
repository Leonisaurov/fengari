"use strict";

const {
    LUA_TNIL,
    LUA_TTABLE,
    lua_close,
    lua_createtable,
    lua_getfield,
    lua_isboolean,
    lua_isnoneornil,
    lua_pop,
    lua_pushboolean,
    lua_pushfstring,
    lua_pushinteger,
    lua_pushliteral,
    lua_pushnil,
    lua_pushnumber,
    lua_pushstring,
    lua_setfield,
    lua_settop,
    lua_toboolean,
    lua_tointegerx
} = require('./lua.js');
const {
    luaL_Buffer,
    luaL_addchar,
    luaL_addstring,
    // luaL_argcheck,
    luaL_argerror,
    luaL_buffinit,
    luaL_checkinteger,
    luaL_checkoption,
    luaL_checkstring,
    luaL_checktype,
    luaL_error,
    luaL_execresult,
    luaL_fileresult,
    luaL_newlib,
    luaL_optinteger,
    luaL_optlstring,
    luaL_optstring,
    luaL_pushresult
} = require('./lauxlib.js');
const {
    LUA_MAXINTEGER,
    LUA_MININTEGER
} = require('./luaconf.js');
const {
    luastring_eq,
    to_jsstring,
    to_luastring
} = require("./fengaricore.js");

/* options for ANSI C 89 (only 1-char options) */
// const L_STRFTIMEC89 = to_luastring("aAbBcdHIjmMpSUwWxXyYZ%");
// const LUA_STRFTIMEOPTIONS = L_STRFTIMEC89;

/* options for ISO C 99 and POSIX */
// const L_STRFTIMEC99 = to_luastring("aAbBcCdDeFgGhHIjmMnprRStTuUVwWxXyYzZ%||EcECExEXEyEYOdOeOHOIOmOMOSOuOUOVOwOWOy");  /* two-char options */
// const LUA_STRFTIMEOPTIONS = L_STRFTIMEC99;

/* options for Windows */
// const L_STRFTIMEWIN = to_luastring("aAbBcdHIjmMpSUwWxXyYzZ%||#c#x#d#H#I#j#m#M#S#U#w#W#y#Y");  /* two-char options */
// const LUA_STRFTIMEOPTIONS = L_STRFTIMEWIN;

/* options for our own strftime implementation
  - should be superset of C89 options for compat
  - missing from C99:
      - ISO 8601 week specifiers: gGV
      - > single char specifiers
  - beyond C99:
      - %k: TZ extension: space-padded 24-hour
      - %l: TZ extension: space-padded 12-hour
      - %P: GNU extension: lower-case am/pm
*/
const LUA_STRFTIMEOPTIONS = to_luastring("aAbBcCdDeFhHIjklmMnpPrRStTuUwWxXyYzZ%");


const setfield = function(L, key, value) {
    lua_pushinteger(L, value);
    lua_setfield(L, -2, to_luastring(key, true));
};

const day_of_year = function(time, utc) {
    let year = utc ? time.getUTCFullYear() : time.getFullYear();
    let month = utc ? time.getUTCMonth() : time.getMonth();
    let day = utc ? time.getUTCDate() : time.getDate();
    /* day indexes from 0, so Jan 1st is day 1 (as in Lua/C) */
    return Math.floor((Date.UTC(year, month, day) - Date.UTC(year, 0, 0)) / 86400000);
};

const setallfields = function(L, time, utc) {
    setfield(L, "sec",   utc ? time.getUTCSeconds()  : time.getSeconds());
    setfield(L, "min",   utc ? time.getUTCMinutes()  : time.getMinutes());
    setfield(L, "hour",  utc ? time.getUTCHours()    : time.getHours());
    setfield(L, "day",   utc ? time.getUTCDate()     : time.getDate());
    setfield(L, "month", (utc ? time.getUTCMonth()   : time.getMonth()) + 1);
    setfield(L, "year",  utc ? time.getUTCFullYear() : time.getFullYear());
    setfield(L, "wday",  (utc ? time.getUTCDay()     : time.getDay()) + 1);
    setfield(L, "yday",  day_of_year(time, utc));
    // setboolfield(L, "isdst", time.get);
};

const L_MAXDATEFIELD = (Number.MAX_SAFE_INTEGER / 2);

const getfield = function(L, key, d, delta) {
    let t = lua_getfield(L, -1, to_luastring(key, true));  /* get field and its type */
    let res = lua_tointegerx(L, -1);
    if (res === false) {  /* field is not an integer? */
        if (t !== LUA_TNIL)  /* some other value? */
            return luaL_error(L, to_luastring("field '%s' is not an integer"), key);
        else if (d < 0)  /* absent field; no default? */
            return luaL_error(L, to_luastring("field '%s' missing in date table"), key);
        res = d;
    }
    else {
        if (!(-L_MAXDATEFIELD <= res && res <= L_MAXDATEFIELD))
            return luaL_error(L, to_luastring("field '%s' is out-of-bound"), key);
        res -= delta;
    }
    lua_pop(L, 1);
    return res;
};


const locale = {
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" ].map((s) => to_luastring(s)),
    shortDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((s) => to_luastring(s)),
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((s) => to_luastring(s)),
    shortMonths: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((s) => to_luastring(s)),
    AM: to_luastring("AM"),
    PM: to_luastring("PM"),
    am: to_luastring("am"),
    pm: to_luastring("pm"),
    formats: {
        c: to_luastring("%a %b %e %H:%M:%S %Y"),
        D: to_luastring("%m/%d/%y"),
        F: to_luastring("%Y-%m-%d"),
        R: to_luastring("%H:%M"),
        r: to_luastring("%I:%M:%S %p"),
        T: to_luastring("%H:%M:%S"),
        X: to_luastring("%T"),
        x: to_luastring("%D")
    }
};

const week_number = function(date, start_of_week, utc) {
    // This works by shifting the weekday back by one day if we
    // are treating Monday as the first day of the week.
    let weekday = utc ? date.getUTCDay() : date.getDay();
    if (start_of_week === 'monday') {
        if (weekday === 0) // Sunday
            weekday = 6;
        else
            weekday--;
    }
    let yday = day_of_year(date, utc) - 1;  /* zero-based */
    return Math.floor((yday + 7 - weekday) / 7);
};

const push_pad_2 = function(b, n, pad) {
    if (n < 10)
        luaL_addchar(b, pad);
    luaL_addstring(b, to_luastring(String(n)));
};

const strftime = function(L, b, s, date, utc) {
    /* Cache the date fields so that every conversion uses the same clock
       (and the UTC variants when the format starts with '!'). */
    const year    = utc ? date.getUTCFullYear() : date.getFullYear();
    const month   = utc ? date.getUTCMonth()    : date.getMonth();
    const day     = utc ? date.getUTCDate()     : date.getDate();
    const wday    = utc ? date.getUTCDay()      : date.getDay();
    const hours   = utc ? date.getUTCHours()    : date.getHours();
    const minutes = utc ? date.getUTCMinutes()  : date.getMinutes();
    const seconds = utc ? date.getUTCSeconds()  : date.getSeconds();
    let i = 0;
    while (i < s.length) {
        if (s[i] !== 37 /* % */) {  /* not a conversion specifier? */
            luaL_addchar(b, s[i++]);
        } else {
            i++;  /* skip '%' */
            let len = checkoption(L, s, i);
            /* each `case` has an example output above it for the UTC epoch */
            switch(s[i]) {
                // '%'
                case 37 /* % */:
                    luaL_addchar(b, 37);
                    break;

                // 'Thursday'
                case 65 /* A */:
                    luaL_addstring(b, locale.days[wday]);
                    break;

                // 'January'
                case 66 /* B */:
                    luaL_addstring(b, locale.months[month]);
                    break;

                // '19'
                case 67 /* C */:
                    push_pad_2(b, Math.floor(year / 100), 48 /* 0 */);
                    break;

                // '01/01/70'
                case 68 /* D */:
                    strftime(L, b, locale.formats.D, date, utc);
                    break;

                // '1970-01-01'
                case 70 /* F */:
                    strftime(L, b, locale.formats.F, date, utc);
                    break;

                // '00'
                case 72 /* H */:
                    push_pad_2(b, hours, 48 /* 0 */);
                    break;

                // '12'
                case 73 /* I */:
                    push_pad_2(b, (hours + 11) % 12 + 1, 48 /* 0 */);
                    break;

                // '00'
                case 77 /* M */:
                    push_pad_2(b, minutes, 48 /* 0 */);
                    break;

                // 'am'
                case 80 /* P */:
                    luaL_addstring(b, hours < 12 ? locale.am : locale.pm);
                    break;

                // '00:00'
                case 82 /* R */:
                    strftime(L, b, locale.formats.R, date, utc);
                    break;

                // '00'
                case 83 /* S */:
                    push_pad_2(b, seconds, 48 /* 0 */);
                    break;

                // '00:00:00'
                case 84 /* T */:
                    strftime(L, b, locale.formats.T, date, utc);
                    break;

                // '00'
                case 85 /* U */:
                    push_pad_2(b, week_number(date, "sunday", utc), 48 /* 0 */);
                    break;

                // '00'
                case 87 /* W */:
                    push_pad_2(b, week_number(date, "monday", utc), 48 /* 0 */);
                    break;

                // '16:00:00'
                case 88 /* X */:
                    strftime(L, b, locale.formats.X, date, utc);
                    break;

                // '1970'
                case 89 /* Y */:
                    luaL_addstring(b, to_luastring(String(year)));
                    break;

                // 'GMT'
                case 90 /* Z */: {
                    if (utc) {
                        luaL_addstring(b, to_luastring("UTC"));
                    } else {
                        let tzString = date.toString().match(/\(([\w\s]+)\)/);
                        if (tzString)
                            luaL_addstring(b, to_luastring(tzString[1]));
                    }
                    break;
                }

                // 'Thu'
                case 97 /* a */:
                    luaL_addstring(b, locale.shortDays[wday]);
                    break;

                // 'Jan'
                case 98 /* b */:
                case 104 /* h */:
                    luaL_addstring(b, locale.shortMonths[month]);
                    break;

                // ''
                case 99 /* c */:
                    strftime(L, b, locale.formats.c, date, utc);
                    break;

                // '01'
                case 100 /* d */:
                    push_pad_2(b, day, 48 /* 0 */);
                    break;

                // ' 1'
                case 101 /* e */:
                    push_pad_2(b, day, 32 /* space */);
                    break;

                // '000'
                case 106 /* j */: {
                    let yday = day_of_year(date, utc);
                    if (yday < 100) {
                        if (yday < 10)
                            luaL_addchar(b, 48 /* 0 */);
                        luaL_addchar(b, 48 /* 0 */);
                    }
                    luaL_addstring(b, to_luastring(String(yday)));
                    break;
                }

                // ' 0'
                case 107 /* k */:
                    push_pad_2(b, hours, 32 /* space */);
                    break;

                // '12'
                case 108 /* l */:
                    push_pad_2(b, (hours + 11) % 12 + 1, 32 /* space */);
                    break;

                // '01'
                case 109 /* m */:
                    push_pad_2(b, month + 1, 48 /* 0 */);
                    break;

                // '\n'
                case 110 /* n */:
                    luaL_addchar(b, 10);
                    break;

                // 'AM'
                case 112 /* p */:
                    luaL_addstring(b, hours < 12 ? locale.AM : locale.PM);
                    break;

                // '12:00:00 AM'
                case 114 /* r */:
                    strftime(L, b, locale.formats.r, date, utc);
                    break;

                // '0'
                case 115 /* s */:
                    luaL_addstring(b, to_luastring(String(Math.floor(date / 1000))));
                    break;

                // '\t'
                case 116 /* t */:
                    luaL_addchar(b, 8);
                    break;

                // '4'
                case 117 /* u */: {
                    luaL_addstring(b, to_luastring(String(wday === 0 ? 7 : wday)));
                    break;
                }

                // '4'
                case 119 /* w */:
                    luaL_addstring(b, to_luastring(String(wday)));
                    break;

                // '12/31/69'
                case 120 /* x */:
                    strftime(L, b, locale.formats.x, date, utc);
                    break;

                // '70'
                case 121 /* y */:
                    push_pad_2(b, year % 100, 48 /* 0 */);
                    break;

                // '+0000'
                case 122 /* z */: {
                    let off = utc ? 0 : date.getTimezoneOffset();
                    if (off > 0) {
                        luaL_addchar(b, 45 /* - */);
                    } else {
                        off = -off;
                        luaL_addchar(b, 43 /* + */);
                    }
                    push_pad_2(b, Math.floor(off/60), 48 /* 0 */);
                    push_pad_2(b, off % 60, 48 /* 0 */);
                    break;
                }
            }
            i += len;
        }
    }
};


const checkoption = function(L, conv, i) {
    let option = LUA_STRFTIMEOPTIONS;
    let o = 0;
    let oplen = 1;  /* length of options being checked */
    for (; o < option.length && oplen <= (conv.length - i); o += oplen) {
        if (option[o] === '|'.charCodeAt(0))  /* next block? */
            oplen++;  /* will check options with next length (+1) */
        else if (luastring_eq(conv.subarray(i, i+oplen), option.subarray(o, o+oplen))) {  /* match? */
            return oplen;  /* return length */
        }
    }
    luaL_argerror(L, 1,
        lua_pushfstring(L, to_luastring("invalid conversion specifier '%%%s'"), conv));
};

/* maximum size for an individual 'strftime' item */
// const SIZETIMEFMT = 250;


const os_date = function(L) {
    let s = luaL_optlstring(L, 1, "%c");
    let stm = lua_isnoneornil(L, 2) ? new Date() : new Date(l_checktime(L, 2) * 1000);
    let utc = false;
    let i = 0;
    if (s[i] === '!'.charCodeAt(0)) {  /* UTC? */
        utc = true;
        i++;  /* skip '!' */
    }
    if (s[i] === "*".charCodeAt(0) && s[i+1] === "t".charCodeAt(0)) {
        lua_createtable(L, 0, 9);  /* 9 = number of fields */
        setallfields(L, stm, utc);
    } else {
        let cc = new Uint8Array(4);
        cc[0] = "%".charCodeAt(0);
        let b = new luaL_Buffer();
        luaL_buffinit(L, b);
        strftime(L, b, s.subarray(i), stm, utc);
        luaL_pushresult(b);
    }
    return 1;
};

const os_time = function(L) {
    let t;
    if (lua_isnoneornil(L, 1))  /* called without args? */
        t = new Date();  /* get current time */
    else {
        luaL_checktype(L, 1, LUA_TTABLE);
        lua_settop(L, 1);  /* make sure table is at the top */
        t = new Date(
            getfield(L, "year", -1, 0),
            getfield(L, "month", -1, 1),
            getfield(L, "day", -1, 0),
            getfield(L, "hour", 12, 0),
            getfield(L, "min", 0, 0),
            getfield(L, "sec", 0, 0)
        );
        setallfields(L, t);
    }

    let secs = Math.floor(t / 1000);
    if (secs >= LUA_MININTEGER && secs <= LUA_MAXINTEGER)
        lua_pushinteger(L, secs);
    else
        lua_pushnumber(L, secs);  /* outside the 32-bit integer range */
    return 1;
};

const l_checktime = function(L, arg) {
    let t = luaL_checkinteger(L, arg);
    // luaL_argcheck(L, t, arg, "time out-of-bounds");
    return t;
};

const os_difftime = function(L) {
    let t1 = l_checktime(L, 1);
    let t2 = l_checktime(L, 2);
    lua_pushnumber(L, t1 - t2);
    return 1;
};

const catnames = ["all", "collate", "ctype", "monetary", "numeric", "time"].map((lc) => to_luastring(lc));
const C = to_luastring("C");
const POSIX = to_luastring("POSIX");
const normalize_locale = function(name) {
    return name.split(".")[0].split("@")[0].replace(/_/g, "-");
};

const locale_decimal = function(tag) {
    if (typeof Intl === "undefined" || typeof Intl.NumberFormat !== "function")
        return null;
    try {
        if (Intl.NumberFormat.supportedLocalesOf([tag]).length === 0)
            return null;
        let parts = new Intl.NumberFormat(tag).formatToParts(1.5);
        for (const part of parts) {
            if (part.type === "decimal")
                return part.value;
        }
        return ".";
    } catch (e) {
        return null;
    }
};

const os_setlocale = function(L) {
    const g = L.l_G;
    const l = luaL_optstring(L, 1, null);
    luaL_checkoption(L, 2, "all", catnames);

    if (l === null) {  /* query the current locale */
        lua_pushstring(L, to_luastring(g.locale));
        return 1;
    }
    if (l.length === 0 || luastring_eq(l, C) || luastring_eq(l, POSIX)) {
        /* empty string resets to the default; POSIX is equivalent to C */
        g.locale = "C";
        g.locale_decimal = ".";
        lua_pushstring(L, C);
        return 1;
    }

    let name;
    try {
        name = to_jsstring(l);
    } catch (e) {
        lua_pushnil(L);
        return 1;
    }
    let decimal = locale_decimal(normalize_locale(name));
    if (decimal === null) {
        lua_pushnil(L);  /* locale not available */
        return 1;
    }

    g.locale = name;
    g.locale_decimal = decimal;
    lua_pushstring(L, l);
    return 1;
};

const syslib = {
    "date": os_date,
    "difftime": os_difftime,
    "setlocale": os_setlocale,
    "time": os_time
};

if (typeof process === "undefined") {
    syslib.clock = function(L) {
        lua_pushnumber(L, performance.now()/1000);
        return 1;
    };
} else {
    /* Only with Node */
    const fs = require('fs');
    const tmp = require('tmp');
    const child_process = require('child_process');

    syslib.exit = function(L) {
        let status;
        if (lua_isboolean(L, 1))
            status = (lua_toboolean(L, 1) ? 0 : 1);
        else
            status = luaL_optinteger(L, 1, 0);
        if (lua_toboolean(L, 2))
            lua_close(L);
        if (L) process.exit(status);  /* 'if' to avoid warnings for unreachable 'return' */
        return 0;
    };

    syslib.getenv = function(L) {
        let key = luaL_checkstring(L, 1);
        key = to_jsstring(key); /* https://github.com/nodejs/node/issues/16961 */
        if (Object.prototype.hasOwnProperty.call(process.env, key)) {
            lua_pushliteral(L, process.env[key]);
        } else {
            lua_pushnil(L);
        }
        return 1;
    };

    syslib.clock = function(L) {
        lua_pushnumber(L, process.uptime());
        return 1;
    };

    const lua_tmpname = function() {
        return tmp.tmpNameSync();
    };

    syslib.remove = function(L) {
        let filename = luaL_checkstring(L, 1);
        try {
            fs.unlinkSync(filename);
        } catch (e) {
            if (e.code === 'EISDIR') {
                try {
                    fs.rmdirSync(filename);
                } catch (e) {
                    return luaL_fileresult(L, false, filename, e);
                }
            } else {
                return luaL_fileresult(L, false, filename, e);
            }
        }
        return luaL_fileresult(L, true);
    };

    syslib.rename = function(L) {
        let fromname = luaL_checkstring(L, 1);
        let toname = luaL_checkstring(L, 2);
        try {
            fs.renameSync(fromname, toname);
        } catch (e) {
            return luaL_fileresult(L, false, false, e);
        }
        return luaL_fileresult(L, true);
    };

    syslib.tmpname = function(L) {
        let name = lua_tmpname();
        if (!name)
            return luaL_error(L, to_luastring("unable to generate a unique filename"));
        lua_pushstring(L, to_luastring(name));
        return 1;
    };

    syslib.execute = function(L) {
        let cmd = luaL_optstring(L, 1, null);
        if (cmd !== null) {
            cmd = to_jsstring(cmd);
            try {
                child_process.execSync(
                    cmd,
                    {
                        stdio: [process.stdin, process.stdout, process.stderr]
                    }
                );
            } catch (e) {
                return luaL_execresult(L, e);
            }

            return luaL_execresult(L, null);
        } else {
            /* Assume a shell is available.
               If it's good enough for musl it's good enough for us.
               http://git.musl-libc.org/cgit/musl/tree/src/process/system.c?id=ac45692a53a1b8d2ede329d91652d43c1fb5dc8d#n22
            */
            lua_pushboolean(L, 1);
            return 1;
        }
    };
}

const luaopen_os = function(L) {
    luaL_newlib(L, syslib);
    return 1;
};

module.exports.luaopen_os = luaopen_os;
