# Pasta `news/`

Imagens das notícias que aparecem na aba **INÍCIO**.

## Como adicionar uma imagem

1. Salva o arquivo PNG/JPG aqui com nome descritivo, ex: `primitivao-resiste.png`
2. No array `NEWS` em `apostas/apostas-app.jsx`, define `image: 'news/seu-arquivo.png'`

Se o arquivo não existir, a notícia ainda renderiza (só sem imagem) — tem fallback `onError` que esconde o `<img>`.

## Imagens esperadas

- `primitivao-resiste.jpg` — a imagem do "PRIMITIVÃO RESISTE!" gerada via IA (mascote caveman defendendo o cofre PC). JPG otimizado via `scripts/optimize-news-image.py`.

## Otimização

Use `scripts/optimize-news-image.py` pra gerar JPG otimizado a partir do PNG original. Padrão: resize pra 900px de largura, qualidade 82, progressive JPEG. Roda em segundos e tipicamente reduz pra ~30% do tamanho original sem perda visual perceptível.
