local mt = {}
mt.__add = function(a, b) return a.v + b.v end
mt.__sub = function(a, b) return a.v - b.v end
mt.__mul = function(a, b) return a.v * b.v end
mt.__div = function(a, b) return a.v / b.v end
mt.__mod = function(a, b) return a.v % b.v end
mt.__pow = function(a, b) return a.v ^ b.v end
mt.__unm = function(a) return -a.v end
mt.__idiv = function(a, b) return a.v // b.v end
mt.__band = function(a, b) return a.v & b.v end
mt.__bor = function(a, b) return a.v | b.v end
mt.__bxor = function(a, b) return a.v ~ b.v end
mt.__shl = function(a, b) return a.v << b.v end
mt.__shr = function(a, b) return a.v >> b.v end
mt.__bnot = function(a) return ~a.v end
mt.__eq = function(a, b) return a.v == b.v end
mt.__lt = function(a, b) return a.v < b.v end
mt.__le = function(a, b) return a.v <= b.v end
mt.__concat = function(a, b) return a.v .. b.v end
mt.__len = function(a) return 99 end
mt.__call = function(self, x) return self.v + x end
mt.__tostring = function(a) return "V(" .. a.v .. ")" end
mt.__index = function(t, k) return "missing:" .. k end
mt.__newindex = function(t, k, v) rawset(t, "raw_" .. k, v) end

local a = setmetatable({ v = 6 }, mt)
local b = setmetatable({ v = 3 }, mt)

print(a + b, a - b, a * b, a / b, a % b, a ^ b)
print(-a, a // b, a & b, a | b, a ~ b, a << b, a >> b, ~a)
print(a == b, a < b, a <= b, a > b, a >= b)
print(a .. b, #a, a(10), tostring(a))
print(a.missing)
a.extra = 5
print(a.raw_extra)
