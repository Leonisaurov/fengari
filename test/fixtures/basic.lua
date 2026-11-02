local function f(a, b)
  local t = {a, b}
  local s = 0
  for i = 1, 3 do s = s + i end
  local x = 4
  local function add(q, y) return x + q + y end
  local function sum(...)
    local n = 0
    for i = 1, select("#", ...) do n = n + select(i, ...) end
    return n
  end
  local g = 0
  for _, v in ipairs({1, 2, 3}) do g = g + v end
  return t[1] + t[2], s, math.floor(a / b), string.upper("x"),
         add(a, b), sum(1, 2, 3), g
end
return f
