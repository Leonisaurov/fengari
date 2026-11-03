"use strict";

const lua     = require('../src/lua.js');
const lauxlib = require('../src/lauxlib.js');
const lualib  = require('../src/lualib.js');
const luaconf = require('../src/luaconf.js');
const {to_luastring, to_jsstring} = require("../src/fengaricore.js");

test('require an existing module', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return require('os')
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_istable(L, -1)).toBe(true);
});


test('require a file', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return require('test.module-hello')()
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("hello from module");
});


test('package.loadlib', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return package.loadlib('./test/lib-hello.js.mod', 'hello')()
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("hello from js lib");
});


test('package.searchpath', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        return package.searchpath('module-hello', './?.lua;./test/?.lua')
    `;
    {
        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, -1);
    }

    expect(lua.lua_tojsstring(L, -1)).toBe("./test/module-hello.lua");
});


test('package.searchpath reports every missing template', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        local file, err = package.searchpath('missing', './?.lua;./test/?.lua')
        assert(file == nil)
        assert(err:find("no file './missing.lua'", 1, true), err)
        assert(err:find("no file './test/missing.lua'", 1, true), err)
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('require uses package.preload and reports missing modules', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        package.preload.preloaded = function() return { answer = 42 } end
        assert(require('preloaded').answer == 42)

        package.preload.novalue = function() end
        assert(require('novalue') == true)

        local ok, err = pcall(require, 'does.not.exist')
        assert(not ok)
        assert(err:find("module 'does.not.exist' not found", 1, true), err)
        assert(err:find("no field package.preload['does.not.exist']", 1, true), err)
        assert(err:find("no file", 1, true), err)

        package.searchers = 1
        local bad, berr = pcall(require, 'anything')
        assert(not bad and berr:find("'package.searchers' must be a table", 1, true), berr)
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('require loads a JS module through package.jspath', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        package.jspath = './test/?.js'
        assert(require('jsmodule') == 'hello from a JS searcher')

        local ok, err = pcall(require, 'jsmodule.missing')
        assert(not ok)
        assert(err:find("no module 'jsmodule.missing' in file './test/jsmodule.js'", 1, true), err)

        -- the root module exists, so the searcher looks for luaopen_jsmodule_sub
        assert(require('jsmodule.sub') == 'hello from a JS searcher')

        -- '-' is the ignore mark: try luaopen_jsmodule first
        package.jspath = './test/jsmodule.js'
        assert(require('jsmodule-other') == 'hello from a JS searcher')
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('require reports a Lua module that fails to load', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        package.path = './test/?.lua'
        local ok, err = pcall(require, 'bad-module')
        assert(not ok)
        assert(err:find("error loading module 'bad-module' from file './test/bad-module.lua'", 1, true), err)
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('package.loadlib reports missing libraries and symbols', () => {
    let L = lauxlib.luaL_newstate();
    if (!L) throw Error("failed to create lua state");

    let luaCode = `
        assert(package.loadlib('./test/lib-hello.js.mod', '*'))

        local f = package.loadlib('./test/lib-hello.js.mod', 'hello')
        assert(f() == 'hello from js lib')

        local nope, err, where = package.loadlib('./test/lib-hello.js.mod', 'nope')
        assert(nope == nil and where == 'init')
        assert(err:find('undefined symbol: nope', 1, true), err)

        local missing, merr, mwhere = package.loadlib('./test/does-not-exist.js', 'hello')
        assert(missing == nil and mwhere == 'open')
        assert(type(merr) == 'string' and #merr > 0)
    `;
    lualib.luaL_openlibs(L);
    expect(lauxlib.luaL_loadstring(L, to_luastring(luaCode))).toBe(lua.LUA_OK);
    lua.lua_call(L, 0, 0);
});


test('package.cpath is exported and honors LUA_CPATH', () => {
    const key = "LUA_CPATH" + lualib.LUA_VERSUFFIX;
    const previous = process.env[key];
    process.env[key] = "pre/?.so;;post/?.so";
    try {
        let L = lauxlib.luaL_newstate();
        if (!L) throw Error("failed to create lua state");

        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L,
            to_luastring("return package.cpath, type(package.jspath)"))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, 2);

        expect(lua.lua_tojsstring(L, -2)).toBe("pre/?.so;./?.so;post/?.so");
        expect(lua.lua_tojsstring(L, -1)).toBe("string");
    } finally {
        if (previous === undefined)
            delete process.env[key];
        else
            process.env[key] = previous;
    }
});

test('package.path expands ;; with the default and versioned env vars', () => {
    const key = "LUA_PATH" + lualib.LUA_VERSUFFIX;
    const previous = process.env[key];
    process.env[key] = "pre/?.lua;;post/?.lua";
    try {
        let L = lauxlib.luaL_newstate();
        if (!L) throw Error("failed to create lua state");

        lualib.luaL_openlibs(L);
        expect(lauxlib.luaL_loadstring(L,
            to_luastring("return package.path"))).toBe(lua.LUA_OK);
        lua.lua_call(L, 0, 1);

        expect(lua.lua_tojsstring(L, -1)).toBe(
            "pre/?.lua;" + to_jsstring(luaconf.LUA_PATH_DEFAULT) + ";post/?.lua");
    } finally {
        if (previous === undefined)
            delete process.env[key];
        else
            process.env[key] = previous;
    }
});
