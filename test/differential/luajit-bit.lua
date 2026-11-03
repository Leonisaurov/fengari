-- LuaJIT bit extension differential corpus (run with LUAJIT_BIT=true).
local function p(...) print(...) end

p(bit.tobit(0xFFFFFFFF), bit.tobit(2^32 + 5), bit.bnot(0))
p(bit.band(0xF0F0, 0xFF00), bit.bor(1, 2, 4), bit.bxor(0xFF, 0x0F))
p(bit.lshift(1, 31), bit.lshift(1, 32), bit.rshift(-1, 1), bit.arshift(-8, 1))
p(bit.rol(0x12345678, 8), bit.ror(0x12345678, 8), bit.bswap(0x12345678))
p(bit.tohex(0x12345678), bit.tohex(0xABCDEF, 4), bit.tohex(0xABCDEF, -4))
p(bit.tohex(0x12345678, 9), bit.tohex(0, 0), bit.tohex(-1))
p(pcall(bit.band) == false, pcall(bit.bor) == false, pcall(bit.bxor) == false)
p(type(bit), type(require("bit")))
