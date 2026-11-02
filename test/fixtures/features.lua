GLOBAL_FIXTURE = 41
local outer = 100

local function make(a, b)
  local x, y = a + 1, b + 2
  local flag = true
  local nothing = nil
  local notflag = not flag

  local big = {}
  for i = 1, 120 do big[i] = i * 2 end
  local sum = 0
  for i = 1, #big do sum = sum + big[i] end

  local nested = function(p)
    return function(q) return x + y + outer + p + q end
  end
  local nf = nested(5)

  -- CLOSE: each iteration closes the upvalue captured by the closure.
  local fs = {}
  for i = 1, 3 do
    local v = i * 10
    fs[i] = function() return v end
  end

  local acc = 0
  local i = 0
  while i < 4 do i = i + 1; acc = acc + i end
  repeat acc = acc + 10 until acc > 20

  local j = 0
  for k = 1, 3, 1 do j = j + k end

  local g = 0
  for _, v in ipairs({3, 4, 5}) do g = g + v end

  if a < b and b ~= 0 or a == 10 then acc = acc + 1 end
  if not (a > b) then acc = acc + 100 end

  -- GETGLOBAL/SETGLOBAL through the synthetic environment upvalue.
  if flag and a == 10 then GLOBAL_FIXTURE = GLOBAL_FIXTURE + 1 end

  -- SETUPVAL and a tail call in a nested prototype.
  local count = 0
  local function inc()
    count = count + 1
    return count
  end
  local function tailcall(v) return v end
  local function use_tail(v) return tailcall(v) end

  -- VARARG with an exact result count and SETLIST with an open result list.
  local function pick(...)
    local p, q = ...
    return (p or 0) + (q or 0)
  end
  local function pack(...)
    return {...}
  end

  -- SELF, NEWTABLE with a hash part, CONCAT and boolean constants.
  local obj = {v = 7}
  function obj:get(d) return self.v + d end
  local s = "a" .. "b" .. "c"
  local bools = {[true] = "yes", [false] = "no"}

  return big[1] + big[120], sum, nf(7), acc, j, g, x + y,
         fs[1]() + fs[3](), pick(4, 5), #pack(1, 2, 3), obj:get(3), s,
         GLOBAL_FIXTURE, flag and "T" or "F", bools[true], bools[false],
         (a - b) + (a / b) + (a % b) + (a ^ b) - a, -a,
         notflag and "N" or "Y", (a <= b) and "LE" or "GT",
         (nothing == nil) and "nil" or "x", inc() + inc(), use_tail("tail")
end

return make
