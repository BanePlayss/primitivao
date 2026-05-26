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

"""Otimiza TODAS as imagens .png da pasta apostas/news/, convertendo pra
JPG (resize 900px + qualidade 82) e DELETANDO o PNG original."""
import glob

NEWS_DIR = r"D:\projects\primitivao\apostas\news"
MAX_WIDTH = 900
JPG_QUALITY = 82

pngs = glob.glob(os.path.join(NEWS_DIR, "*.png"))
if not pngs:
    print("Nenhum .png em apostas/news/ pra otimizar.")
    sys.exit(0)

print(f"Encontrei {len(pngs)} PNG(s) pra otimizar:\n")
for png_path in pngs:
    img = Image.open(png_path).convert("RGB")
    orig_size = os.path.getsize(png_path)
    name = os.path.basename(png_path)
    print(f"- {name}")
    print(f"  in:  {img.size}  {orig_size:,} bytes")

    if img.width > MAX_WIDTH:
        new_h = round(img.height * MAX_WIDTH / img.width)
        img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)

    jpg_path = png_path.replace(".png", ".jpg")
    img.save(jpg_path, "JPEG", quality=JPG_QUALITY, optimize=True, progressive=True)
    new_size = os.path.getsize(jpg_path)
    pct = 100 * new_size / orig_size
    print(f"  out: {img.size}  {new_size:,} bytes  ({pct:.1f}% do original)")

    # Apaga o PNG original (já que JPG é mais leve)
    os.remove(png_path)
    # Sem unicode no print pra evitar UnicodeEncodeError no console cp1252 do Windows
    print(f"  OK: {os.path.basename(jpg_path)} salvo, PNG removido\n")
