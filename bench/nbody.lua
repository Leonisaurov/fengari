-- N-body style force accumulation over a small set of bodies.
local bodies = {
    { 0, 0, 0, 0, 0, 0, 1 },
    { 4.84, -1.16, -0.10, 0.60, 2.81, -0.02, 0.0009 },
    { 8.34, 4.12, -0.40, -1.01, 3.04, 0.07, 0.0005 },
    { 12.89, -15.11, -0.92, 1.28, -1.25, 0.01, 0.0007 },
    { -15.03, -15.93, -0.11, 1.51, -0.02, 0.00, 0.0006 }
}
local steps = 20000
local dt = 0.001
local n = #bodies

for _ = 1, steps do
    for i = 1, n do
        local bi = bodies[i]
        for j = i + 1, n do
            local bj = bodies[j]
            local dx = bi[1] - bj[1]
            local dy = bi[2] - bj[2]
            local dz = bi[3] - bj[3]
            local d2 = dx * dx + dy * dy + dz * dz
            local mag = dt / (d2 * math.sqrt(d2))
            bi[4] = bi[4] - dx * bj[7] * mag
            bi[5] = bi[5] - dy * bj[7] * mag
            bi[6] = bi[6] - dz * bj[7] * mag
            bj[4] = bj[4] + dx * bi[7] * mag
            bj[5] = bj[5] + dy * bi[7] * mag
            bj[6] = bj[6] + dz * bi[7] * mag
        end
    end
    for i = 1, n do
        local b = bodies[i]
        b[1] = b[1] + dt * b[4]
        b[2] = b[2] + dt * b[5]
        b[3] = b[3] + dt * b[6]
    end
end

local energy = 0
for i = 1, n do
    local b = bodies[i]
    energy = energy + 0.5 * b[7] * (b[4] * b[4] + b[5] * b[5] + b[6] * b[6])
end

return math.floor(energy * 1e6)
