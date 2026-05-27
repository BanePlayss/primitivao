# Avatares dos jogadores

Cada jogador tem um PNG cartoonizado no estilo **retrato sépia de manchete antiga**,
coerente com a estética do site (Bagel Fat One + bege + laranja).

## Specs técnicas

| Item              | Valor                                                          |
| ----------------- | -------------------------------------------------------------- |
| Formato           | PNG                                                            |
| Dimensão          | **512×512** (quadrado)                                         |
| Fundo             | **Transparente** (PNG com alpha) ou bege liso `#f4ead7`        |
| Composição        | Cabeça e ombros, olhando pra frente, expressão dramática       |
| Paleta            | sépia/bege `#f4ead7`, charcoal `#1c1612`, laranja `#d76414`    |
| Texto na imagem   | NÃO (nem nome nem watermark)                                   |
| Peso              | < 80KB (otimizar com `scripts/optimize-news-image.py`)         |

## Nomes dos arquivos

Um por jogador, nome em lowercase:

```
avatars/bane.png
avatars/mohamed.png
avatars/potato.png
avatars/magreza.png
avatars/celin.png
avatars/juca.png
avatars/caco.png
avatars/vitinho.png
```

## Prompt master (Claude Design / DALL-E / Midjourney)

Copia e troca **{NOME}** e **{DESCRICAO_FISICA}** pra cada jogador:

```
Vintage Brazilian newspaper headline portrait of a man called {NOME}.

Style: 1950s tabloid sepia tones with bold orange (#d76414) accents,
dramatic high-contrast lighting, halftone newspaper print texture
overlay, slightly grainy, cream paper background (#f4ead7). Looks like
a half-page headline character cut-out from an old Folha de São Paulo
or O Estado de S.Paulo.

Character: {DESCRICAO_FISICA}

Composition: head and shoulders, facing slightly to the left,
serious / slightly dramatic / determined expression. Square 1:1
aspect ratio. Plain background (cream or transparent).

Palette: cream #f4ead7, charcoal #1c1612, burnt orange #d76414,
small amount of dark red #7a2222 only for shadow.

No text in image. No watermark. No emoji. No modern UI elements.
Output: PNG 512x512.
```

## Se você tem foto real de cada jogador (recomendado)

Use **img2img** no Claude Design ou Midjourney:

1. Upload da foto da pessoa
2. Cole o prompt acima trocando `{DESCRICAO_FISICA}` por algo como
   "transform the uploaded photo into this style, keeping the recognizable features"
3. Gere

## Se não tem foto

Preenche `{DESCRICAO_FISICA}` com uma descrição rápida do tipo:

- **Bane**: "tall, dark beard, intense eyes, looking like a brooding villain from a telenovela"
- **Mohamed**: "thin, glasses, looking exhausted, defeated expression"
- ... (uma frase por jogador)

## Workflow de adicionar

1. Gera o PNG no gerador de imagem
2. Salva como `apostas/avatars/<nick>.png`
3. (opcional) Otimiza: `python scripts/optimize-news-image.py apostas/avatars/<nick>.png`
4. `git add apostas/avatars/<nick>.png && git commit -m "feat(avatar): add <nick>"`
5. Push — Action recompila, avatar aparece no site

## Fallback

Enquanto o PNG do jogador não existe, o app mostra um círculo bege
com a letra inicial do nick (ex: "B" pra Bane). Não quebra nada se
faltar.
