-- Helper used by compare.js: times dofile(file) with a best-of-N wall clock.
local file = assert(arg and arg[1], "missing benchmark file")
local times = tonumber(arg[2]) or 3
local best = math.huge

for _ = 1, times do
    local start = os.clock()
    dofile(file)
    local elapsed = os.clock() - start
    if elapsed < best then
        best = elapsed
    end
end

print(string.format("%.6f", best))
