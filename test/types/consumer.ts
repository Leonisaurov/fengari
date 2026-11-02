/**
 * Compile-only consumer for the published type definitions.
 *
 * Run with `pnpm typecheck`. It is not executed by Jest and is not published.
 */
import fengari, {
    api,
    lauxlib,
    lua,
    lualib,
    to_jsstring,
    to_luastring,
    versions,
    vfs,
    type LuaState,
    type LuaString
} from "fengari";

const state = api.createState({ version: "5.3" });
const L: LuaState = state.L;

const source: LuaString = to_luastring("return 1 + 2");
const text: string = to_jsstring(source);
const result: any = state.run(source);
const asyncResult: Promise<any> = state.runAsync("return 4");
const globalResult: any = api.call(L, "tostring", [text]);

lua.lua_pushliteral(L, "hello");
lua.lua_pushlstring(L, to_luastring("hello"), 5);
lua.lua_pushinteger(L, 2147483647);
lua.lua_pushnumber(L, 1.5);
lua.lua_setglobal(L, "greeting");
lua.lua_setwarnf(L, (_ud, msg, tocont) => {
    void msg;
    void tocont;
}, null);
lua.lua_warning(L, "check", 0);
const closeStatus: number = lua.lua_closethread(lua.lua_newthread(L), L);

const top: number = lua.lua_gettop(L);
const status: number = lauxlib.luaL_loadstring(L, source);
lualib.luaL_openlibs(L);

const names: string[] = versions.list();
const defaultVersion: string = versions.getDefault();
const snapshot = vfs.snapshot();
vfs.mount("example.lua", to_luastring("return 42"));
vfs.restore(snapshot);

const sameRuntime: boolean = fengari.lua === lua;
state.close();

void [result, asyncResult, globalResult, top, status, names, defaultVersion, sameRuntime, closeStatus];
