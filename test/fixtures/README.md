# Native PUC bytecode fixtures

These files are **real PUC Lua binary chunks**, used to test the native
5.1/5.2 loaders. They are not produced by Fengari.

The `.lua` sources in this directory are the exact inputs used to build the
fixtures. The `luac` paths below are examples from the machine used to
generate them; any PUC Lua 5.1.5 / 5.2.4 build works.

## Basic fixture

`basic.lua` builds `lua51.luac` and `lua52.luac`:

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

```sh
/tmp/lua-5.1.5/src/luac -o lua51.luac basic.lua
/tmp/lua-5.2.4/src/luac -o lua52.luac basic.lua
```

Calling the returned function with `(10, 2)` prints:

```text
12	6	5	X	16	6	6
```

It exercises constants, arithmetic, tables, loops, closures with upvalues,
varargs, generic-for and global access.

## Feature fixture

`features.lua` builds `lua51_features.luac` and `lua52_features.luac`. It is
designed to exercise **every PUC Lua 5.1 opcode**:

```sh
/tmp/lua-5.1.5/src/luac -o lua51_features.luac features.lua
/tmp/lua-5.2.4/src/luac -o lua52_features.luac features.lua
```

`make(10, 2)` prints:

```text
242	14520	127	31	6	12	15	40	9	3	10	abc	42	T	yes	no	103	-10	Y	GT	nil	3	tail
```

It covers multiple/nested upvalue descriptors, nested closures, `CLOSE`,
every jump form (`JMP`, `FORPREP`/`FORLOOP`, `TFORLOOP`, comparison and test
jumps), `SELF`, `VARARG` with both fixed and open result counts, `SETLIST`
with an open result list, `NEWTABLE`, `CONCAT`, `#`, `GETGLOBAL`/`SETGLOBAL`
through the synthetic environment upvalue, `SETUPVAL`, `TAILCALL`, `NOT`,
`LE`, `UNM` and boolean locals and constants.

## SETLIST overflow fixture

`lua51_setlist.luac` and `lua52_setlist.luac` are a 25551-field table
constructor. Past 25550 fields PUC emits `SETLIST` with `C == 0`: 5.1 stores
the block number in a bare following word, while 5.2/5.3 use `EXTRAARG`.
This is the smallest constructor that reaches that path.

Generate the source with any language or shell loop; this is the exact
Node.js invocation used here:

```sh
node -e '
const fs = require("fs");
const n = 25551;
const s = "local x = 1\nlocal big = {\n" + "x,\n".repeat(n) +
          "}\nreturn big[1] + big[" + n + "]\n";
fs.writeFileSync("setlist.lua", s);
'
/tmp/lua-5.1.5/src/luac -s -o lua51_setlist.luac setlist.lua
/tmp/lua-5.2.4/src/luac -s -o lua52_setlist.luac setlist.lua
```

`-s` strips the debug information so the fixture stays around 100 KB each.
Running the chunk returns `2`.

## Validation fixtures

`test/native-bytecode.test.js` also corrupts copies of these chunks in memory
to check signature, format, header-size and truncation errors; no extra files
are needed.
