-- String operations: concat, sub, gsub, format and byte access.
local acc = 0
local base = string.rep("abcdefghij", 50)

for i = 1, 20000 do
    local s = base .. i
    acc = acc + #s
    acc = acc + string.byte(s, (i % #s) + 1)
    acc = acc + #string.gsub(s, "a", "A")
    acc = acc + #string.format("%s:%d:%.3f", string.sub(s, 1, 20), i, i / 3)
end

return acc
