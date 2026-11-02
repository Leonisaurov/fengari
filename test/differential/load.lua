local f = assert(load("return x", "chunk", "t", { x = 5 }))
print(f())

local parts = { "return ", "1+", "2" }
local i = 0
local g = assert(load(function()
    i = i + 1
    return parts[i]
end))
print(g())

local ok, err = load("return 1", "c", "b")
print(ok == nil, err:match("text chunk") ~= nil)
print(load("syntax error") == nil)

local h = assert(load("return ..."))
print(h(1, 2, 3))

print(load(string.dump(function()
    return 7
end))())

local chunk = assert(load("return _ENV.marker", "env", "t", { marker = "env-ok" }))
print(chunk())
