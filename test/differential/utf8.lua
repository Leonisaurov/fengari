local s = "héllo 😀"
print(#s, utf8.len(s))
print(utf8.char(104, 233))
print(utf8.codepoint("é"), utf8.codepoint("😀"))
print(utf8.offset(s, 1), utf8.offset(s, 2), utf8.offset(s, -1))
for p, c in utf8.codes(s) do
    io.write(p, ":", c, " ")
end
print()
print(utf8.len("\xff"))
print(utf8.len("abc", 1, 2))
print(utf8.charpattern)
