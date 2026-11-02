# Benchmarks

Each `*.lua` file is a self-contained benchmark that returns a value (the
runner ignores it). Timings are wall-clock milliseconds for a full state
creation, `luaL_openlibs`, load and run.

- `node bench/run.js` runs every benchmark on Fengari (best of 3 by default).
  Options: `--repeat=N`, `--warmup=N`, `--filter=regex`, `--json`.
- `node bench/compare.js` also runs them under PUC Lua (`$LUA_BIN`, then
  `lua5.3`, `lua5.4`, `lua`) and prints the ratio. PUC time is measured with
  `os.clock()` inside a single process, so process startup is excluded from
  both sides.

Caveats:

- Fengari implements Lua 5.3 with 32-bit integers; PUC 5.3+ uses 64-bit
  integers. These benchmarks stay inside the 32-bit range so the comparison is
  meaningful.
- Timings are indicative, not a controlled benchmark: GC, JIT warmup and CPU
  frequency are not isolated. Use the same machine and several runs.
- PUC here is 5.4 when 5.3 is not installed; the parser/VM differences are not
  relevant for these loops.
