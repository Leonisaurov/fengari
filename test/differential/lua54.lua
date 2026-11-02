-- Lua 5.4 <const>/<close> differential corpus.
-- Only prints deterministic results so it can run under PUC Lua 5.4 and
-- Fengari's 5.4 profile with byte-identical stdout.

local function check(name, cond)
    print(name, cond and "ok" or "FAIL")
end

-- <const> is read-only, including from nested functions
local c <const> = 10
check("const.read", c == 10)
local f1, e1 = load("local x <const> = 1; x = 2")
check("const.assign", f1 == nil and e1:find("const variable 'x'", 1, true) ~= nil)
local f2, e2 = load("local x <const> = 1; return function() x = 2 end")
check("const.upvalue", f2 == nil and e2:find("const variable 'x'", 1, true) ~= nil)

-- <close> runs in reverse declaration order
local log = {}
local mt = { __close = function(o) log[#log + 1] = o.n end }
local function mk(n) return setmetatable({ n = n }, mt) end

do
    local a <close> = mk(1)
    local b <close> = mk(2)
end
check("close.block", table.concat(log, ",") == "2,1")

log = {}
for i = 1, 3 do
    local a <close> = mk(i)
    if i == 2 then break end
end
check("close.break", table.concat(log, ",") == "1,2")

log = {}
do
    local a <close> = mk(1)
    goto done
end
::done::
check("close.goto", table.concat(log, ",") == "1")

log = {}
local function with_return()
    local a <close> = mk(1)
    do
        local b <close> = mk(2)
        return 9
    end
end
check("close.return", with_return() == 9 and table.concat(log, ",") == "2,1")

-- the error object reaches __close, and remaining scopes still close
log = {}
local seen_error
local mt2 = { __close = function(o, err) log[#log + 1] = o.n; seen_error = err end }
local function mk2(n) return setmetatable({ n = n }, mt2) end
local ok, err = pcall(function()
    local a <close> = mk2(1)
    error("boom")
end)
check("close.error", not ok and log[1] == 1 and seen_error ~= nil and
    tostring(seen_error):find("boom", 1, true) ~= nil)

-- invalid declarations
local okv, msgv = pcall(load("local x <close> = 42"))
check("close.nonclosable", not okv and
    tostring(msgv):find("non-closable", 1, true) ~= nil)
local fm, em = load("local a <close>, b <close> = nil, nil")
check("close.multiple", fm == nil and
    em:find("multiple to-be-closed", 1, true) ~= nil)
check("close.false", pcall(function()
    local a <close> = nil
    local b <close> = false
end))

-- the fourth generic-for value is to-be-closed (Lua 5.4)
log = {}
local function gen(_, c)
    c = c + 1
    if c <= 3 then return c end
end
for x in gen, nil, 0, setmetatable({ n = 4 }, mt) do end
check("close.for", table.concat(log, ",") == "4")

log = {}
for x in gen, nil, 0, setmetatable({ n = 4 }, mt) do
    if x == 2 then break end
end
check("close.for.break", table.concat(log, ",") == "4")

-- coroutine.close runs pending closers
log = {}
local co = coroutine.create(function()
    local a <close> = mk(1)
    coroutine.yield(5)
end)
coroutine.resume(co)
local closed = coroutine.close(co)
check("close.coroutine", closed == true and table.concat(log, ",") == "1")

-- a failed coroutine closes its variables and reports the original error
log = {}
local failed = coroutine.create(function()
    local a <close> = mk(1)
    error("bad")
end)
local rok, rerr = coroutine.resume(failed)
local cok, cerr = coroutine.close(failed)
check("close.failed", not rok and cok == false and log[1] == 1 and
    tostring(cerr):find("bad", 1, true) ~= nil and
    tostring(rerr):find("bad", 1, true) ~= nil)

-- __close may yield during normal unwinding
local ylog = {}
local ymt = {
    __close = function(o)
        ylog[#ylog + 1] = o.n
        coroutine.yield("y" .. o.n)
    end
}
local function ymk(n) return setmetatable({n = n}, ymt) end
local yco = coroutine.create(function()
    do
        local a <close> = ymk(1)
        local b <close> = ymk(2)
        coroutine.yield("body")
    end
    return table.concat(ylog, ",")
end)
local yielded = {}
for i = 1, 5 do
    local ok, v = coroutine.resume(yco)
    yielded[#yielded + 1] = ok and tostring(v) or "ERR"
    if coroutine.status(yco) == "dead" then break end
end
check("close.yield", table.concat(yielded, "|") == "body|y2|y1|2,1")

-- tail calls close the current frame
log = {}
local function tail()
    local a <close> = mk(1)
    return (function() return 8 end)()
end
check("close.tailcall", tail() == 8 and table.concat(log, ",") == "1")
