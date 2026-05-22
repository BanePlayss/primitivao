"""Remove o fundo bege do ícone do Primitivão via flood-fill.

Estratégia:
1. Carrega imagem como RGBA.
2. Faz flood-fill a partir dos 4 cantos, marcando pixels conectados a eles que
   sejam similares à cor de fundo (tolerância) como transparentes.
3. Preserva tons creme DENTRO do escudo (não estão conectados aos cantos).
4. Salva PNG com transparência.
"""
import sys
from PIL import Image
from collections import deque

SRC = r"D:\projects\primitivao\refs\primitivao-icon.png"
DST = r"D:\projects\primitivao\apostas\primitivao-icon.png"

# Tolerância de cor (canais 0-255). Quanto maior, mais agressivo.
TOL = 55

img = Image.open(SRC).convert("RGBA")
w, h = img.size
print(f"loaded {w}x{h}")
px = img.load()

# Cor de referência: média dos 4 cantos
corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
sample = [px[x, y] for x, y in corners]
avg = tuple(sum(c[i] for c in sample) // len(sample) for i in range(3))
print(f"bg color sample (avg of corners): {avg}")

def close(c):
    return all(abs(c[i] - avg[i]) <= TOL for i in range(3))

visited = [[False] * h for _ in range(w)]
q = deque()
for x, y in corners:
    if close(px[x, y]):
        q.append((x, y))
        visited[x][y] = True

filled = 0
while q:
    x, y = q.popleft()
    r, g, b, _ = px[x, y]
    px[x, y] = (r, g, b, 0)  # transparent
    filled += 1
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny]:
            if close(px[nx, ny]):
                visited[nx][ny] = True
                q.append((nx, ny))

print(f"transparent pixels: {filled}")

# Redimensiona pra 512x512 (mais que suficiente pra icon + login, e 1254px
# era exagero pra um favicon).
TARGET = 512
img = img.resize((TARGET, TARGET), Image.LANCZOS)

# Quantiza pra palette indexada — o logo usa basicamente 4 cores (preto,
# laranja, creme, transparente), então 64 cores na palette eh muito mais
# que suficiente e comprime drasticamente.
img_idx = img.quantize(colors=64, method=Image.Quantize.FASTOCTREE)
img_idx.save(DST, "PNG", optimize=True)
print(f"saved -> {DST}")

