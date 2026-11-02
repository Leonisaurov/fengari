# Skipped Lua test-suite cases

The adapted PUC suite keeps a small number of tests skipped when they assert
implementation details that do not exist in Fengari. This file records each
one so a future change can tell a real gap from an intentional difference.

Current bounded skips (1): one in `nextvar.test.js` (none in `api.test.js`).
Platform-conditional skips (`process.platform === "win32"`) and the
`lua_bin === null` differential guards are not part of this list.

## `nextvar: JS tests` (table internal sizes)

Uses `T.int2fb` and `T.querytab` to assert PUC's array-part/hash-part sizes.
Fengari stores table entries in a `Map` and has no array/hash split, so the
expected numbers are not meaningful. Revisit only if the table representation
is replaced with a PUC-like split.

## Revisiting

A test can move out of this list when the corresponding capability is
implemented (for example a PUC-like table representation or a byte-accounted
allocator). Until then, a skipped test here is a documented representation
difference, not untested Lua behaviour.

## Recently enabled

`api: testing get/setuservalue` now runs. `T.gcstate`/`T.gccolor` are
compatibility shims: `"pause"` forces a full collection and reachable
collectable objects report `"black"` because Fengari delegates collection to
the JS GC. The test still checks that a userdata uservalue survives a full
collection.

`api: test whether udate collection frees memory in the right time` now runs.
Userdata are tracked for memory accounting, unreachable userdata count until a
full collection, and userdata with a finalizer are kept for one extra cycle
(`g.pending_udata`), so `collectgarbage("count")` follows PUC's TM-then-free
ordering.

`api: testing deep JS stack` now runs. It exercises `lua_checkstack`, the
`LUAI_MAXSTACK` limit and dynamic stack growth with the JS-backed stack;
`luaL_checkstack` now reserves error slots so a full stack still reports
`stack overflow` instead of an empty error.

The six memory-limit tests (`api: testing memory limits`, `api: testing memory
errors when creating a new state`, `api: test thread creation after stressing
GC`, `api: testing memory x compiler`, `api: testing memory x dofile` and
`api: other generic tests`) now run. `T.totalmem` sets a test-only allocation
budget: allocations charge the object's estimated size, new table keys add a
fixed cost, and `lua_newuserdata` rejects oversized blocks. The budget is
approximate rather than PUC's exact byte accounting, but it exercises the
`LUA_ERRMEM` paths and the `testamem` harness. The two tests that relied on a
local `b` or `testprog` from another test now define them locally.

## Review after the 5.1/5.2 work

The 5.1/5.2 library-surface and `%.14g` work did not make the remaining test
runnable. All `api.test.js` gaps are now enabled with `T.gcstate`/`T.gccolor`
shims, two-phase userdata accounting, stack-overflow error reservation and a
test-only `T.totalmem` allocation budget. The only bounded skip left is
`nextvar: JS tests`, which needs PUC's array/hash table split.
