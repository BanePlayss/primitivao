"""Otimiza imagens da pasta apostas/news/.

Estratégia:
- Resize pra max 900px de largura (display fica até ~760px no .inicio-feed)
- Quantiza pra palette de 128 cores (suficiente pra arte tipo cartaz/rupestre)
- PNG otimizado

Uso: edita SRC abaixo, roda `python scripts/optimize-news-image.py`.
"""
import os
import sys
from PIL import Image

SRC = r"D:\projects\primitivao\apostas\news\primitivao-resiste.png"
DST_JPG = r"D:\projects\primitivao\apostas\news\primitivao-resiste.jpg"
MAX_WIDTH = 900
JPG_QUALITY = 82  # 80-85 é bom equilíbrio (visualmente quase indistinguível)

img = Image.open(SRC).convert("RGB")
orig_size = os.path.getsize(SRC)
print(f"in:  {img.size}  {img.mode}  {orig_size:,} bytes")

# Resize mantendo aspecto
if img.width > MAX_WIDTH:
    new_h = round(img.height * MAX_WIDTH / img.width)
    img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)

img.save(DST_JPG, "JPEG", quality=JPG_QUALITY, optimize=True, progressive=True)
new_size = os.path.getsize(DST_JPG)
print(f"out: {img.size}  JPG q{JPG_QUALITY}  {new_size:,} bytes  ({100 * new_size / orig_size:.1f}% do original)")
print(f"     {DST_JPG}")
