/**
 * Type definitions for Fengari.
 *
 * The C API is large; the most used symbols are typed explicitly and each
 * namespace keeps an index signature so uncommon functions still type-check.
 */

export type LuaString = Uint8Array;

/** Opaque Lua state. */
export interface LuaState {
    [key: string]: any;
}

export type LuaFunction = (L: LuaState) => number;

export interface LuaAPI {
    LUA_OK: number;
    LUA_YIELD: number;
    LUA_ERRRUN: number;
    LUA_ERRSYNTAX: number;
    LUA_ERRMEM: number;
    LUA_ERRGCMM: number;
    LUA_ERRERR: number;
    LUA_MULTRET: number;
    LUA_REGISTRYINDEX: number;

    lua_close(L: LuaState): void;
    lua_pcall(L: LuaState, nargs: number, nresults: number, errfunc: number): number;
    lua_call(L: LuaState, nargs: number, nresults: number): void;
    lua_gettop(L: LuaState): number;
    lua_settop(L: LuaState, idx: number): void;
    lua_pushvalue(L: LuaState, idx: number): void;
    lua_remove(L: LuaState, idx: number): void;
    lua_insert(L: LuaState, idx: number): void;
    lua_replace(L: LuaState, idx: number): void;
    lua_rotate(L: LuaState, idx: number, n: number): void;
    lua_pop(L: LuaState, n: number): void;

    lua_pushnil(L: LuaState): void;
    lua_pushboolean(L: LuaState, b: boolean): void;
    lua_pushnumber(L: LuaState, n: number): void;
    lua_pushinteger(L: LuaState, n: number): void;
    lua_pushstring(L: LuaState, s: LuaString | string | null): LuaString | null;
    lua_pushliteral(L: LuaState, s: string): LuaString;
    lua_pushlstring(L: LuaState, s: LuaString, len: number): LuaString;
    lua_pushcfunction(L: LuaState, fn: LuaFunction): void;
    lua_pushcclosure(L: LuaState, fn: LuaFunction, n: number): void;
    lua_pushlightuserdata(L: LuaState, p: any): void;

    lua_toboolean(L: LuaState, idx: number): boolean;
    lua_tonumber(L: LuaState, idx: number): number;
    lua_tointeger(L: LuaState, idx: number): number;
    lua_tostring(L: LuaState, idx: number): LuaString | null;
    lua_tojsstring(L: LuaState, idx: number): string | null;
    lua_touserdata(L: LuaState, idx: number): any;
    lua_tocfunction(L: LuaState, idx: number): LuaFunction | null;
    lua_tothread(L: LuaState, idx: number): LuaState;
    lua_topointer(L: LuaState, idx: number): any;

    lua_type(L: LuaState, idx: number): number;
    lua_typename(L: LuaState, t: number): LuaString;
    lua_isnil(L: LuaState, idx: number): boolean;
    lua_isboolean(L: LuaState, idx: number): boolean;
    lua_isnumber(L: LuaState, idx: number): boolean;
    lua_isinteger(L: LuaState, idx: number): boolean;
    lua_isstring(L: LuaState, idx: number): boolean;
    lua_istable(L: LuaState, idx: number): boolean;
    lua_isfunction(L: LuaState, idx: number): boolean;
    lua_isnone(L: LuaState, idx: number): boolean;
    lua_isnoneornil(L: LuaState, idx: number): boolean;

    lua_getglobal(L: LuaState, name: LuaString | string): number;
    lua_setglobal(L: LuaState, name: LuaString | string): void;
    lua_getfield(L: LuaState, idx: number, k: LuaString | string): number;
    lua_setfield(L: LuaState, idx: number, k: LuaString | string): void;
    lua_gettable(L: LuaState, idx: number): number;
    lua_settable(L: LuaState, idx: number): void;
    lua_rawget(L: LuaState, idx: number): number;
    lua_rawgeti(L: LuaState, idx: number, n: number): number;
    lua_rawseti(L: LuaState, idx: number, n: number): void;
    lua_rawlen(L: LuaState, idx: number): number;
    lua_next(L: LuaState, idx: number): number;
    lua_createtable(L: LuaState, narr: number, nrec: number): void;
    lua_newtable(L: LuaState): void;
    lua_newuserdata(L: LuaState, size?: number): any;
    lua_setmetatable(L: LuaState, idx: number): number;
    lua_getmetatable(L: LuaState, idx: number): number;

    lua_sethook(L: LuaState, fn: LuaFunction | null, mask: number, count: number): void;
    lua_gethook(L: LuaState): LuaFunction | null;
    lua_gethookmask(L: LuaState): number;
    lua_gethookcount(L: LuaState): number;
    lua_getinfo(L: LuaState, what: LuaString | string, ar: any): number;

    lua_dump(L: LuaState, writer: (L: LuaState, b: Uint8Array, size: number, data: any) => number, data: any, strip: boolean): number;
    lua_load(L: LuaState, reader: LuaFunction, data: any, chunkname: LuaString, mode: LuaString | null): number;

    [name: string]: any;
}

export interface AuxLibAPI {
    luaL_newstate(version?: string): LuaState | null;
    luaL_loadstring(L: LuaState, s: LuaString | string): number;
    luaL_loadbuffer(L: LuaState, s: LuaString, size: number, name: LuaString): number;
    luaL_loadbufferx(L: LuaState, s: LuaString, size: number, name: LuaString, mode: LuaString | null): number;
    luaL_loadfile(L: LuaState, filename: LuaString | string): number;
    luaL_dostring(L: LuaState, s: LuaString | string): number;
    luaL_dofile(L: LuaState, filename: LuaString | string): number;
    luaL_traceback(L: LuaState, L1: LuaState, msg: LuaString | null, level: number): void;
    luaL_error(L: LuaState, fmt: LuaString | string, ...args: any[]): number;
    luaL_checkstring(L: LuaState, arg: number): LuaString;
    luaL_optstring(L: LuaState, arg: number, def: LuaString | string | null): LuaString | null;
    luaL_checkinteger(L: LuaState, arg: number): number;
    luaL_optinteger(L: LuaState, arg: number, def: number): number;
    luaL_checknumber(L: LuaState, arg: number): number;
    luaL_newlib(L: LuaState, functions: Record<string, LuaFunction>): void;
    luaL_newmetatable(L: LuaState, name: LuaString | string): number;
    luaL_setmetatable(L: LuaState, name: LuaString | string): void;
    luaL_getmetatable(L: LuaState, name: LuaString | string): number;
    luaL_requiref(L: LuaState, name: LuaString | string, open: LuaFunction, glb: number): void;
    luaL_fileresult(L: LuaState, status: boolean, fname: LuaString | null, error?: any): number;
    luaL_execresult(L: LuaState, error: any): number;
    [name: string]: any;
}

export interface LuaLibAPI {
    luaL_openlibs(L: LuaState): void;
    luaopen_base(L: LuaState): number;
    luaopen_coroutine(L: LuaState): number;
    luaopen_table(L: LuaState): number;
    luaopen_io(L: LuaState): number;
    luaopen_os(L: LuaState): number;
    luaopen_string(L: LuaState): number;
    luaopen_math(L: LuaState): number;
    luaopen_utf8(L: LuaState): number;
    luaopen_debug(L: LuaState): number;
    luaopen_package(L: LuaState): number;
    [name: string]: any;
}

export interface VersionRegistry {
    register(impl: any): void;
    get(name: string): any;
    list(): string[];
    setDefault(name: string): void;
    features(name: string): any;
    [name: string]: any;
}

export interface VfsSnapshotEntry {
    path: string;
    data: Uint8Array;
}

export interface Vfs {
    mount(path: string, contents: string | Uint8Array): void;
    unmount(path: string): boolean;
    readFile(path: string): Uint8Array | null;
    listFiles(): string[];
    snapshot(): VfsSnapshotEntry[];
    restore(entries: VfsSnapshotEntry[]): void;
    reset(): void;
    setStdin(contents: string | Uint8Array): void;
    setStdout(handler: ((line: string) => void) | null): (line: string) => void;
    setStderr(handler: ((line: string) => void) | null): (line: string) => void;
    flush(): void;
    setEnv(key: string, value: string): void;
    loadFromURL(url: string, path?: string): Promise<number>;
    saveToStorage(key: string): number;
    loadFromStorage(key: string): number;
    clearStorage(key: string): void;
    saveToIndexedDB(key: string): Promise<number>;
    loadFromIndexedDB(key: string): Promise<number>;
    clearFromIndexedDB(key: string): Promise<void>;
    saveToOPFS(directory: any, key: string): Promise<number>;
    loadFromOPFS(directory: any, key: string): Promise<number>;
    clearFromOPFS(directory: any, key: string): Promise<void>;
    mountOPFS(directory: any, options?: { files?: string[] }): Promise<number>;
    unmountOPFS(): boolean;
    allowNetwork(enabled: boolean): boolean;
    networkEnabled(): boolean;
    useMemory(): any;
    useNode(): any;
    current(): string;
}

export interface ApiState {
    L: LuaState;
    run(source: string | LuaString, chunkname?: string): any;
    dostring(source: string | LuaString, chunkname?: string): any;
    runAsync(source: string | LuaString, chunkname?: string): Promise<any>;
    dofile(filename: string): any;
    call(fn: string | number, args?: any[]): any;
    callAsync(fn: string | number, args?: any[]): Promise<any>;
    toJS(idx: number): any;
    pushJS(value: any): void;
    pushAsyncJS(fn: (...args: any[]) => any): void;
    installAsyncModules(options?: AsyncModuleOptions): void;
    close(): void;
}

export interface AsyncModuleOptions {
    base?: string;
    extension?: string;
    map?: Record<string, string>;
    fetch?: (name: string, url: string) => Promise<string | null | undefined> | string | null | undefined;
}

export interface SandboxOptions {
    instructions?: number;
    milliseconds?: number;
    /** Approximate memory limit in KB. */
    memory?: number;
    hide?: string[];
    version?: string;
}

export interface Sandbox {
    L: LuaState;
    run(source: string | LuaString, chunkname?: string): any;
    dostring(source: string | LuaString, chunkname?: string): any;
    call(fn: string | number, args?: any[]): any;
    reset(): void;
    close(): void;
}

export interface ApiHelpers {
    createState(options?: { version?: string; openlibs?: boolean }): ApiState;
    run(L: LuaState, source: string | LuaString, chunkname?: string): any;
    dostring(L: LuaState, source: string | LuaString, chunkname?: string): any;
    runAsync(L: LuaState, source: string | LuaString, chunkname?: string): Promise<any>;
    dofile(L: LuaState, filename: string): any;
    call(L: LuaState, fn: string | number, args?: any[]): any;
    callAsync(L: LuaState, fn: string | number, args?: any[]): Promise<any>;
    toJS(L: LuaState, idx: number): any;
    pushJS(L: LuaState, value: any): void;
    pushAsyncJS(L: LuaState, fn: (...args: any[]) => any): void;
    installAsyncModules(L: LuaState, options?: AsyncModuleOptions): void;
    sandbox(options?: SandboxOptions): Sandbox;
}

export const lua: LuaAPI;
export const lauxlib: AuxLibAPI;
export const lualib: LuaLibAPI;
export const versions: VersionRegistry;
export const vfs: Vfs;
export const api: ApiHelpers;
export const luaconf: Record<string, any>;

export const FENGARI_AUTHORS: string;
export const FENGARI_COPYRIGHT: string;
export const FENGARI_RELEASE: string;
export const FENGARI_VERSION: string;
export const FENGARI_VERSION_MAJOR: string;
export const FENGARI_VERSION_MINOR: string;
export const FENGARI_VERSION_NUM: number;
export const FENGARI_VERSION_RELEASE: string;

export function to_luastring(s: string, cache?: boolean): LuaString;
export function to_jsstring(s: LuaString): string;
export function to_uristring(s: LuaString): string;
export function luastring_eq(a: LuaString, b: LuaString): boolean;
export function luastring_indexOf(a: LuaString, v: number): number;
export function luastring_of(...bytes: number[]): LuaString;

declare const fengari: {
    lua: LuaAPI;
    lauxlib: AuxLibAPI;
    lualib: LuaLibAPI;
    versions: VersionRegistry;
    vfs: Vfs;
    api: ApiHelpers;
    luaconf: Record<string, any>;
    to_luastring: typeof to_luastring;
    to_jsstring: typeof to_jsstring;
    to_uristring: typeof to_uristring;
    [name: string]: any;
};

export default fengari;
