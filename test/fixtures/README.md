# Native PUC bytecode fixtures

These files are **real PUC Lua binary chunks**, used to test the native
5.1/5.2 loaders. They are not produced by Fengari.

## Basic fixture

`lua51.luac` and `lua52.luac` were generated from this source with PUC 5.1.5
and 5.2.4 (`luac`):

```lua
local function f(a, b)
  local t = {a, b}
  local s = 0
  for i = 1, 3 do s = s + i end
  local x = 4
  local function add(q, y) return x + q + y end
  local function sum(...)
    local n = 0
    for i = 1, select("#", ...) do n = n + select(i, ...) end
    return n
  end
  local g = 0
  for _, v in ipairs({1, 2, 3}) do g = g + v end
  return t[1] + t[2], s, math.floor(a / b), string.upper("x"),
         add(a, b), sum(1, 2, 3), g
end
return f
```

Commands:

```sh
/tmp/lua-5.1.5/src/luac -o lua51.luac fixture.lua
/tmp/lua-5.2.4/src/luac -o lua52.luac fixture.lua
```

Calling the returned function with `(10, 2)` should print:

```text
12	6	5	X	16	6	6
```

The fixture exercises constants, arithmetic, tables, loops, closures with
upvalues, varargs, generic-for and global access.

## Feature fixture

`lua51_features.luac` and `lua52_features.luac` come from the same source
(`test/fixtures/features.lua` was generated from the block below):

```lua
local outer = 100

local function make(a, b)
  local x, y = a + 1, b + 2

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

  -- VARARG with an exact result count and SETLIST with an open result list.
  local function pick(...)
    local p, q = ...
    return (p or 0) + (q or 0)
  end
  local function pack(...)
    return {...}
  end

  -- SELF, NEWTABLE with a hash part, CONCAT.
  local obj = {v = 7}
  function obj:get(d) return self.v + d end
  local s = "a" .. "b" .. "c"

  return big[1] + big[120], sum, nf(7), acc, j, g, x + y,
         fs[1]() + fs[3](), pick(4, 5), #pack(1, 2, 3), obj:get(3), s
end

return make
```

`make(10, 2)` prints:

```text
242	14520	127	31	6	12	15	40	9	3	10	abc
```

It covers multiple/nested upvalue descriptors, nested closures, `CLOSE`,
every jump form (`JMP`, `FORPREP`/`FORLOOP`, `TFORLOOP`, comparison and test
jumps), `SELF`, `VARARG` with both fixed and open result counts, `SETLIST`
with an open result list, `NEWTABLE`, `CONCAT` and `#`.

## SETLIST overflow fixture

`lua51_setlist.luac` and `lua52_setlist.luac` are a 25551-field table
constructor. Past 25550 fields PUC emits `SETLIST` with `C == 0`: 5.1 stores
the block number in a bare following word, while 5.2/5.3 use `EXTRAARG`.
This is the smallest constructor that reaches that path.

```lua
local x = 1
local big = {x, x, ...}  -- 25551 entries
return big[1] + big[25551]
```

```sh
/tmp/lua-5.1.5/src/luac -s -o lua51_setlist.luac setlist.lua
/tmp/lua-5.2.4/src/luac -s -o lua52_setlist.luac setlist.lua
```

`-s` strips the debug information so the fixture stays around 100 KB each.
Running the chunk returns `2`.
