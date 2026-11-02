local name = ".diff-io.tmp"
os.remove(name)

local f = assert(io.open(name, "w"))
f:write("alpha\n", "beta\n", 42, "\n")
f:close()

f = assert(io.open(name, "r"))
print(f:read("l"))
print(f:read("n"))
print(string.format("%q", f:read("a")))
print(f:seek("set", 0), f:seek("end"))
f:close()

for line in io.lines(name) do
    io.write("[", line, "]")
end
print()

print(io.type(f))
print(io.open(name) == nil)
os.remove(name)
print(io.open(name) == nil)
