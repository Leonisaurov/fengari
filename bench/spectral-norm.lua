-- Spectral norm benchmark (arrays and loops).
local n = 80

local function eval_a(i, j)
    return 1 / ((i + j) * (i + j + 1) / 2 + i + 1)
end

local function mul_av(v)
    local r = {}
    for i = 0, n - 1 do
        local sum = 0
        for j = 0, n - 1 do
            sum = sum + eval_a(i, j) * v[j + 1]
        end
        r[i + 1] = sum
    end
    return r
end

local function mul_atv(v)
    local r = {}
    for i = 0, n - 1 do
        local sum = 0
        for j = 0, n - 1 do
            sum = sum + eval_a(j, i) * v[j + 1]
        end
        r[i + 1] = sum
    end
    return r
end

local u = {}
for i = 1, n do
    u[i] = 1
end

for _ = 1, 10 do
    local v = mul_av(u)
    u = mul_atv(v)
end

local vbv, vv = 0, 0
for i = 1, n do
    vbv = vbv + u[i] * u[i]
    vv = vv + u[i] * u[i]
end

return math.floor(math.sqrt(vbv / vv) * 1e9)
