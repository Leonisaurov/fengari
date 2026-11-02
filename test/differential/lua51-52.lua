-- Lua 5.1/5.2 differential corpus.
-- Uses only syntax accepted by both versions and branches on _VERSION for the
-- version-specific library surface. stdout must match PUC byte for byte.

local function check(name, cond)
    print(name, cond and "ok" or "FAIL")
end

-- numbers are doubles with PUC's %.14g formatting
check("value.int", tostring(1.0) == "1")
check("value.float", tostring(1.5) == "1.5")
check("value.third", tostring(1/3) == "0.33333333333333")
check("value.big", tostring(1e20) == "1e+20")
check("value.small", tostring(1e-7) == "1e-07")
check("value.inf", tostring(1/0) == "inf")
check("value.ninf", tostring(-1/0) == "-inf")
check("value.tie1", tostring(123456789012345) == "1.2345678901234e+14")
check("value.tie2", tostring(123456789012355) == "1.2345678901236e+14")
check("value.sub", tostring(2^-1074) == "4.9406564584125e-324")
check("value.mantissa", tostring(2^53) == "9.007199254741e+15")
check("value.pow", tostring(2^63) == "9.2233720368548e+18")
check("value.fixed", tostring(0.0001) == "0.0001")
check("value.sci", tostring(0.00001) == "1e-05")
check("value.fmtg", string.format("%.14g", 1/3) == "0.33333333333333")
check("value.hexbig", tostring(0x8000000000000000) == "9.2233720368548e+18")
check("value.hexmax", tostring(0xffffffffffffffff) == "1.844674407371e+19")
check("value.hexparse", tostring(tonumber("0x8000000000000000")) ==
      "9.2233720368548e+18")
check("value.decparse", tostring(tonumber("9223372036854775807")) ==
      "9.2233720368548e+18")

-- table keys are exposed as numbers
local t = {[7] = true}
local k = next(t)
check("key.num", type(k) == "number")
check("key.fmt", tostring(k) == "7")
check("key.eq", k == 7.0)

-- %q and %a follow the profile
check("fmt.qint", string.format("%q", 7) == '"7"')
check("fmt.qfloat", string.format("%q", 1.5) == '"1.5"')
local oka = pcall(string.format, "%a", 1.0)
if _VERSION == "Lua 5.1" then
    check("fmt.a51", not oka)
else
    check("fmt.a52", oka)
end

-- aliases present in both versions
check("lib.unpack", type(unpack) == "function" and unpack({1, 2}) == 1)
check("lib.loadstring", type(loadstring) == "function" and
      loadstring("return 9")() == 9)
check("lib.maxn", type(table.maxn) == "function" and
      table.maxn({[5] = true}) == 5)
check("lib.cpath", type(package.cpath) == "string")
check("lib.loaders", type(package.loaders) == "table")
check("lib.gmatch", type(string.gmatch) == "function")

if _VERSION == "Lua 5.1" then
    check("lib51.gfind", type(string.gfind) == "function")
    check("lib51.foreach", type(table.foreach) == "function")
    check("lib51.foreachi", type(table.foreachi) == "function")
    check("lib51.mod", type(math.mod) == "function" and math.mod(7, 3) == 1)
    check("lib51.gcinfo", type(gcinfo) == "function" and gcinfo() >= 0)
    check("lib51.getfenv", type(debug.getfenv) == "function")
    check("lib51.setfenv", type(debug.setfenv) == "function")
    check("lib51.nouservalue", type(debug.getuservalue) == "nil")
    local sum = 0
    table.foreach({1, 2, 3}, function(_, v) sum = sum + v end)
    check("lib51.foreach.run", sum == 6)
    local isum = 0
    table.foreachi({"a", "b"}, function(i) isum = isum + i end)
    check("lib51.foreachi.run", isum == 3)
else
    check("lib52.nogfind", type(string.gfind) == "nil")
    check("lib52.maxn", type(table.maxn) == "function")
    check("lib52.module", type(module) == "function")
    check("lib52.seeall", type(package.seeall) == "function")
    check("lib52.loaders", package.loaders == package.searchers)
    check("lib52.nogcinfo", type(gcinfo) == "nil")
end
