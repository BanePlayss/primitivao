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

## Prompt definitivo (img2img — cola junto com a foto)

```
Transform this photo into a vintage Brazilian newspaper headline
portrait, in the style of a 1950s tabloid headline cut-out.

KEEP RECOGNIZABLE: preserve the person's face shape, hair, beard,
glasses, skin tone, and overall identity. The person should still
look like themselves — only the rendering style changes.

STYLE:
- Sepia tones with subtle orange (#d76414) accent in shadows/highlights
- Halftone newspaper print texture overlay, slightly grainy
- High-contrast dramatic lighting, hard shadows
- Cream paper background (#f4ead7), plain, no other elements
- Slight desaturation, vintage feel
- No glossy modern look, no skin smoothing

COMPOSITION:
- Head and shoulders bust shot, centered
- 1:1 square aspect ratio (512×512)
- Subject facing forward or slightly to the left
- Keep their natural expression — if smiling, keep it; if serious, keep it

DO NOT INCLUDE: text, watermark, logos, emoji, lens flare, modern
UI elements, busy background, glasses reflection, multiple people.

Output: PNG 512×512, plain cream background.
```

## Como rodar

**Claude Design**: anexa foto + cola prompt. Se o fundo vier poluído ou
com texto, peça *"Refaça com fundo creme uniforme, sem texto."*

**Midjourney**: `/imagine [URL_DA_FOTO] vintage Brazilian newspaper
headline portrait, sepia tones with #d76414 accents, halftone print
texture, dramatic lighting, cream background, head and shoulders,
no text --ar 1:1 --style raw --iw 1.5` (o `--iw 1.5` aumenta o peso
da imagem de referência → preserva mais a fisionomia).

**Stable Diffusion (img2img)**: denoise strength **0.55–0.70**, CFG 7–8,
30+ steps. Menos que 0.55 fica realista demais; mais que 0.70 perde a cara.

**DALL-E 3 (ChatGPT)**: não tem img2img puro; cola foto e prompt, o
ChatGPT vai descrever a pessoa pra ele. Resultado menos fiel.

## Dicas pra ficar coerente entre os 8

1. **Gera todos no mesmo dia, na mesma ferramenta** — IAs mudam de
   comportamento; mistura de ferramentas faz cada avatar parecer de
   "lugar diferente".
2. **Pede 3-4 variações** por jogador e escolhe a melhor.
3. **Se um sair fora do estilo**, regenera pedindo *"match the style
   of [link da que ficou boa]"*.
4. **Compara lado a lado** antes de salvar — abre todos os 8 e vê se
   a paleta/textura tá uniforme.

## Se NÃO tiver foto de algum

Preenche o prompt acima trocando a frase "this photo" por:
"a man named {NOME} who looks {DESCRICAO_RAPIDA}".

Exemplo:
- Bane: *"a man named Bane who looks tall, dark beard, intense eyes,
  brooding villain expression"*

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
