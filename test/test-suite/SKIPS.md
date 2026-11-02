# Skipped Lua test-suite cases

The adapted PUC suite keeps a small number of tests skipped when they assert
implementation details that do not exist in Fengari. This file records each
one so a future change can tell a real gap from an intentional difference.

Current bounded skips (0): no test in `api.test.js` or `nextvar.test.js` is
skipped. Platform-conditional skips (`process.platform === "win32"`) and the
`lua_bin === null` differential guards are not part of this list.

## Revisiting

A test can move out of this list when the corresponding capability is
implemented (for example a PUC-like table representation or a byte-accounted
allocator). Until then, a skipped test here is a documented representation
difference, not untested Lua behaviour.

## Recently enabled

`api: testing get/setuservalue` runs. `T.gcstate`/`T.gccolor` are compatibility
shims: `"pause"` forces a full collection and reachable collectable objects
report `"black"` because Fengari delegates collection to the JS GC. The test
still checks that a userdata uservalue survives a full collection.

`api: test whether udate collection frees memory in the right time` runs.
Userdata are tracked for memory accounting, unreachable userdata count until a
full collection, and userdata with a finalizer are kept for one extra cycle
(`g.pending_udata`), so `collectgarbage("count")` follows PUC's TM-then-free
ordering.

`api: testing deep JS stack` runs. It exercises `lua_checkstack`, the
`LUAI_MAXSTACK` limit and dynamic stack growth with the JS-backed stack;
`luaL_checkstack` now reserves error slots so a full stack still reports
`stack overflow` instead of an empty error.

The six memory-limit tests (`api: testing memory limits`, `api: testing memory
errors when creating a new state`, `api: test thread creation after stressing
GC`, `api: testing memory x compiler`, `api: testing memory x dofile` and
`api: other generic tests`) run. `T.totalmem` sets a test-only allocation
budget: allocations charge the object's estimated size, new table keys add a
fixed cost, and `lua_newuserdata` rejects oversized blocks. The budget is
approximate rather than PUC's exact byte accounting, but it exercises the
`LUA_ERRMEM` paths and the `testamem` harness. The two tests that relied on a
local `b` or `testprog` from another test define them locally.

`nextvar: JS tests` runs. `T.int2fb` implements PUC's floating-byte conversion
and `T.querytab` reports PUC-compatible array/hash sizes. `Table` carries
`puc_alimit`/`puc_hsize`/`puc_hused` metadata, updated by `OP_NEWTABLE` hints,
`OP_SETLIST`, `lua_createtable` and new-key insertions; rehashes follow PUC's
`computesizes` and power-of-two hash sizing.

## Review after the 5.1/5.2 work

All previously bounded skips are now enabled: `api.test.js` uses
`T.gcstate`/`T.gccolor` shims, two-phase userdata accounting, stack-overflow
error reservation and a test-only `T.totalmem` allocation budget, while
`nextvar.test.js` uses the PUC-compatible table-sizing metadata.
