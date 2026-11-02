local function sum(...)
    local total = 0
    for i = 1, select("#", ...) do
        total = total + select(i, ...)
    end
    return total
end
print(sum(1, 2, 3, 4))
print(select("#", 1, nil, 3), select(2, "a", "b", "c"))

local function counter()
    local n = 0
    return function()
        n = n + 1
        return n
    end
end
local c = counter()
print(c(), c(), c())

local function multi()
    return 1, 2, 3
end
print(multi())

local function tail(n, acc)
    if n == 0 then
        return acc
    end
    return tail(n - 1, acc + n)
end
print(tail(100, 0))

local x = 0
::again::
x = x + 1
if x < 3 then
    goto again
end
print(x)

for i = 1, 3 do
    local f = function()
        return i
    end
    io.write(f(), " ")
end
print()

local a, b = 1, 2
a, b = b, a
print(a, b)
