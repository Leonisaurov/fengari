local co = coroutine.create(function(a, b)
    local x = coroutine.yield(a + b)
    return x * 2
end)

print(coroutine.status(co))
print(coroutine.resume(co, 2, 3))
print(coroutine.status(co))
print(coroutine.resume(co, 10))
print(coroutine.status(co))

local gen = coroutine.wrap(function()
    for i = 1, 3 do
        coroutine.yield(i)
    end
end)
print(gen(), gen(), gen())
print(coroutine.isyieldable())

local ok = pcall(function()
    coroutine.yield(1)
end)
print(ok)

local co2 = coroutine.create(function()
    error("boom")
end)
local resumed, err = coroutine.resume(co2)
print(resumed, type(err), coroutine.status(co2))

local wrapped = coroutine.wrap(function()
    error("wrapped")
end)
print(pcall(wrapped))
