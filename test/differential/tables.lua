local t = { 3, 1, 2 }
table.sort(t)
print(table.concat(t, ","))
table.insert(t, 4)
table.insert(t, 1, 0)
print(table.concat(t, ","))
print(table.remove(t), table.concat(t, ","))
print(table.remove(t, 1), table.concat(t, ","))

local a = { 1, 2, 3 }
print(table.concat(a, "-"))
table.move(a, 1, 3, 2, a)
print(table.concat(a, ","))
print(table.unpack({ 10, 20, 30 }))

local h = {}
h["b"] = 2
h["a"] = 1
h["c"] = 3
local keys = {}
for k in pairs(h) do
    keys[#keys + 1] = k
end
table.sort(keys)
print(table.concat(keys, ""))
local n = 0
for _, v in pairs(h) do
    n = n + v
end
print(n)
print(#t)
