print(pcall(error, "oops"))
print(pcall(function()
    error("boom", 0)
end))
local ok3, err3 = pcall(function()
    error({ code = 1 })
end)
print(ok3, type(err3), err3.code)

local ok, err = pcall(function()
    error({ code = 7 })
end)
print(ok, type(err), err.code)

print(xpcall(function()
    error("x", 0)
end, function(message)
    return "handled:" .. message
end))

print(select("#", pcall(function()
    return 1, 2, 3
end)))

print(pcall(function()
    assert(false, "assertion")
end))

local ok2, err2 = pcall(function()
    local t = nil
    return t.field
end)
print(ok2, err2:match("index") ~= nil)
