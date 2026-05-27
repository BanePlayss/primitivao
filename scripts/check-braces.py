"""Conta balance de {} () [] no apostas-app.jsx, ignorando strings/comentarios."""
import re

with open(r"D:\projects\primitivao\apostas\apostas-app.jsx", "r", encoding="utf-8") as f:
    src = f.read()

# Remove comments
clean = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
clean = re.sub(r"//.*", "", clean)

def strip_strings(s):
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in ("'", '"'):
            j = i + 1
            while j < n and s[j] != c:
                if s[j] == "\\":
                    j += 2
                else:
                    j += 1
            i = j + 1
        elif c == "`":
            # template literal: pode ter ${} dentro com mais aspas — simplifica
            j = i + 1
            depth = 0
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "$" and j + 1 < n and s[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if s[j] == "}" and depth > 0:
                    depth -= 1
                    j += 1
                    continue
                if s[j] == "`" and depth == 0:
                    break
                j += 1
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)

s = strip_strings(clean)
print("opening { :", s.count("{"), "closing } :", s.count("}"))
print("opening ( :", s.count("("), "closing ) :", s.count(")"))
print("opening [ :", s.count("["), "closing ] :", s.count("]"))
