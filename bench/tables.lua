-- Array and hash table operations.
local array = {}
for i = 1, 200000 do
    array[i] = i
end
local sum = 0
for i = 1, #array do
    sum = sum + array[i]
end

local hash = {}
for i = 1, 50000 do
    hash["key" .. (i % 1000)] = i
end
for k, v in pairs(hash) do
    sum = sum + v + #k
end

for i = #array, 1, -1 do
    if i % 2 == 0 then
        array[i] = nil
    end
end

return sum + #array
