-- Floating point arithmetic in a tight loop.
local size = 60
local inside = 0
for y = 0, size - 1 do
    local ci = 2 * y / size - 1
    for x = 0, size - 1 do
        local cr = 2 * x / size - 1.5
        local zr, zi = 0, 0
        local i = 0
        while i < 50 and zr * zr + zi * zi <= 4 do
            zr, zi = zr * zr - zi * zi + cr, 2 * zr * zi + ci
            i = i + 1
        end
        if i == 50 then
            inside = inside + 1
        end
    end
end

return inside
