"use strict";

/*
** Registry of Lua version implementations.
**
** A version module exposes:
**   name       unique name ("5.1", "5.2", "5.3", ...)
**   version    { major, minor, release, num, string }
**   features   metadata used by hosts (integers, bitwise, goto, env, ...)
**   openlibs?  (L) => void; adjusts library globals after luaL_openlibs
**   loadbufferx? (L, buff, size, name, mode) => status; replaces the loader
**
** The bundled 5.1/5.2 profiles change the library surface; the lexer,
** parser and VM currently implement Lua 5.3 semantics. A full alternative
** implementation can provide loadbufferx/openlibs, or register new modules.
*/

const { LUA_VERSION } = require('./luaconf.js');

const implementations = new Map();
let default_version = LUA_VERSION || "5.3";

const normalize = function(name) {
    let s = String(name).toLowerCase().trim();
    s = s.replace(/^lua\s*/, "");
    if (/^5[1234]$/.test(s))
        s = s[0] + "." + s[1];
    return s;
};

const register = function(impl) {
    if (!impl || typeof impl.name !== "string")
        throw new TypeError("version implementation needs a name");
    if (!impl.version || typeof impl.version.num !== "number")
        throw new TypeError("version implementation needs version.num");
    if (!impl.features || typeof impl.features !== "object")
        throw new TypeError("version implementation needs features");
    implementations.set(normalize(impl.name), impl);
    return impl;
};

const get = function(name) {
    const key = normalize(name === undefined || name === null ? default_version : name);
    const impl = implementations.get(key);
    if (!impl)
        throw new Error("unknown Lua version: " + key);
    return impl;
};

const list = function() {
    return Array.from(implementations.keys());
};

const setDefault = function(name) {
    const impl = get(name);
    default_version = normalize(impl.name);
    return impl;
};

const getDefault = function() {
    return default_version;
};

const current = function(L) {
    return L && L.l_G ? L.l_G.impl : null;
};

const features = function(L) {
    const impl = current(L);
    return impl ? impl.features : null;
};

register(require('./versions/lua51.js'));
register(require('./versions/lua52.js'));
register(require('./versions/lua53.js'));
register(require('./versions/lua54.js'));

if (!implementations.has(normalize(default_version)))
    default_version = "5.3";

module.exports.current = current;
module.exports.features = features;
module.exports.get = get;
module.exports.getDefault = getDefault;
module.exports.list = list;
module.exports.normalize = normalize;
module.exports.register = register;
module.exports.setDefault = setDefault;
