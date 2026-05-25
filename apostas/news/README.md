# Pasta `news/`

Imagens das notícias que aparecem na aba **INÍCIO**.

## Como adicionar uma imagem

1. Salva o arquivo PNG/JPG aqui com nome descritivo, ex: `primitivao-resiste.png`
2. No array `NEWS` em `apostas/apostas-app.jsx`, define `image: 'news/seu-arquivo.png'`

Se o arquivo não existir, a notícia ainda renderiza (só sem imagem) — tem fallback `onError` que esconde o `<img>`.

## Imagens esperadas

- `primitivao-resiste.png` — a imagem do "PRIMITIVÃO RESISTE!" gerada via IA (mascote caveman defendendo o cofre PC)
