/**
 * ES module entry point. The implementation is CommonJS; this wrapper exposes
 * the same named exports for `import { lua } from "fengari"`.
 */
import fengari from "./fengari.js";

export const FENGARI_AUTHORS = fengari.FENGARI_AUTHORS;
export const FENGARI_COPYRIGHT = fengari.FENGARI_COPYRIGHT;
export const FENGARI_RELEASE = fengari.FENGARI_RELEASE;
export const FENGARI_VERSION = fengari.FENGARI_VERSION;
export const FENGARI_VERSION_MAJOR = fengari.FENGARI_VERSION_MAJOR;
export const FENGARI_VERSION_MINOR = fengari.FENGARI_VERSION_MINOR;
export const FENGARI_VERSION_NUM = fengari.FENGARI_VERSION_NUM;
export const FENGARI_VERSION_RELEASE = fengari.FENGARI_VERSION_RELEASE;

export const luastring_eq = fengari.luastring_eq;
export const luastring_indexOf = fengari.luastring_indexOf;
export const luastring_of = fengari.luastring_of;
export const to_jsstring = fengari.to_jsstring;
export const to_luastring = fengari.to_luastring;
export const to_uristring = fengari.to_uristring;

export const luaconf = fengari.luaconf;
export const lua = fengari.lua;
export const lauxlib = fengari.lauxlib;
export const lualib = fengari.lualib;
export const versions = fengari.versions;
export const vfs = fengari.vfs;
export const api = fengari.api;

export default fengari;
