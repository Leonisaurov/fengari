# Skipped Lua test-suite cases

The adapted PUC suite keeps a small number of tests skipped when they assert
implementation details that do not exist in Fengari. This file records each
one so a future change can tell a real gap from an intentional difference.

Current bounded skips (9): eight in `api.test.js` and one in `nextvar.test.js`.
Platform-conditional skips (`process.platform === "win32"`) and the
`lua_bin === null` differential guards are not part of this list.

## `nextvar: JS tests` (table internal sizes)

Uses `T.int2fb` and `T.querytab` to assert PUC's array-part/hash-part sizes.
Fengari stores table entries in a `Map` and has no array/hash split, so the
expected numbers are not meaningful. Revisit only if the table representation
is replaced with a PUC-like split.

## `api: testing deep JS stack`

Asserts PUC C-stack limits (`LUAI_MAXCCALLS`), `checkstack 1000023` failures and
a one-million-instruction harness. The JavaScript engine stack is not the C
stack. The harness part could be reduced, but the test's purpose is the C stack,
so it stays skipped.

## `api: udata collection frees memory in the right time`

Requires PUC's two-phase userdata finalization (first cycle runs `__gc`, the
next releases memory) and exact byte accounting. Fengari releases the object
when the finalizer runs, so the intermediate `collectgarbage("count")`
assertion cannot hold.

## Memory-limit tests

These six tests depend on `T.totalmem` plus the `testamem` harness:

- `api: testing memory limits`
- `api: testing memory errors when creating a new state`
- `api: test thread creation after stressing GC`
- `api: testing memory x compiler`
- `api: testing memory x dofile`
- `api: other generic tests`

`T.totalmem` requires a settable memory limit that makes **every** allocation
path fail with `LUA_ERRMEM` at controlled points; the JavaScript GC does not
expose that. `api.sandbox` has an approximate `collectgarbage("count")` limit
instead, covered by `test/api.test.js`.

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

## Review after the 5.1/5.2 work

The 5.1/5.2 library-surface and `%.14g` work did not make any of the remaining
tests runnable. One test (`api: testing get/setuservalue`) was enabled
separately with `T.gcstate`/`T.gccolor` shims. The remaining nine still depend
on PUC's array/hash table split, C-stack accounting, two-phase userdata
finalization or a settable allocator.
