# Native PUC bytecode fixtures

These files are **real PUC Lua binary chunks**, used to test the native
5.1/5.2 loaders. They are not produced by Fengari.

Generated from this source with PUC 5.1.5 and 5.2.4 (`luac`):

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
