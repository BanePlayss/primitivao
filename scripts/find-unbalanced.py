"""Rastreia balance de () linha-por-linha e reporta picos desbalanceados.
Ajuda a localizar onde tem ( sem ) correspondente.
"""
import re

with open(r"D:\projects\primitivao\apostas\apostas-app.jsx", "r", encoding="utf-8") as f:
    src = f.read()

# Strip comments
clean = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
clean = re.sub(r"//.*", "", clean)


def strip_strings(s):
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in ("'", '"'):
            out.append(" ")
            j = i + 1
            while j < n and s[j] != c:
                if s[j] == "\\":
                    j += 2
                else:
                    j += 1
            i = j + 1
        elif c == "`":
            out.append(" ")
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

# Acompanha balance linha-por-linha
depth = 0
stack = []  # (line, col)
issues = []
for ln_no, line in enumerate(s.split("\n"), start=1):
    for col, ch in enumerate(line):
        if ch == "(":
            depth += 1
            stack.append((ln_no, col))
        elif ch == ")":
            if stack:
                stack.pop()
            depth -= 1
            if depth < 0:
                issues.append(("under", ln_no, col))
                depth = 0
                stack = []

print(f"final depth: {depth}")
print(f"unclosed parens (showing last 10):")
for ln, col in stack[-10:]:
    print(f"  line {ln} col {col}")
print(f"underflows: {len(issues)}")
