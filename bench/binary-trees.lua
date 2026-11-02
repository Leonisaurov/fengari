-- Allocation and traversal of many small tables.
local function bottom_up(depth)
    if depth == 0 then
        return {}
    end
    return { bottom_up(depth - 1), bottom_up(depth - 1) }
end

local function check(node)
    if node[1] then
        return 1 + check(node[1]) + check(node[2])
    end
    return 1
end

local total = 0
for _ = 1, 10 do
    local tree = bottom_up(12)
    total = total + check(tree)
end

return total
