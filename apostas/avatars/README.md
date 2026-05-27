# Avatares dos jogadores

Cada jogador tem um PNG **estilo chibi/Xbox Avatar** — cabeça grande,
corpo pequeno, vibe divertida, mas mantendo o rosto reconhecível.
Paleta alinhada com o site (bege/laranja/charcoal).

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
Transform this photo into a chibi-style avatar inspired by Xbox Avatars
and Nintendo Mii — playful, cartoony, friendly.

KEEP RECOGNIZABLE: preserve the person's hairstyle, beard, glasses,
skin tone, and general facial features. Should clearly read as them.

STYLE:
- Chibi proportions: head is ~40% of total height, large round eyes,
  small simplified body
- Clean vector-style flat shading, soft cel shading, no realistic
  texture
- Bold but smooth outline around silhouette (~2-3px equivalent)
- Bright, friendly, expressive — slight cartoon exaggeration of
  their actual features
- Neutral standing pose, arms relaxed at sides or one slightly raised
  in a wave/peace sign

PALETTE: cream background #f4ead7, primary accent burnt orange #d76414
in clothing or props, charcoal #1c1612 for outlines. Keep their natural
hair and skin colors. Outfit: simple t-shirt in the team color (see
below), plain pants in coordinated tones.

COMPOSITION:
- HEAD CENTERED IN THE UPPER 60% OF THE FRAME (critical — this
  avatar gets cropped to a small icon; face must stay visible)
- Full body visible but cropped at mid-thigh
- 1:1 square aspect ratio
- Plain cream or transparent background, no shadows under feet, no
  other elements

DO NOT INCLUDE: text, watermark, logos, busy background, realistic
proportions, photorealistic textures, scary/horror style, multiple
characters.

Output: PNG 512×512, plain cream or transparent background.
```

### Cor da camiseta por jogador (use o hex)

| Jogador  | Cor da camiseta |
| -------- | --------------- |
| Bane     | `#1c1612` (charcoal) |
| Mohamed  | `#c75418` (laranja queimado) |
| Potato   | `#8b3a14` (marrom-laranja) |
| Magreza  | `#2a201a` (marrom escuro) |
| Celin    | `#e8800f` (laranja vivo) |
| Juca     | `#d63c0a` (vermelho-laranja) |
| Caco     | `#4a3020` (marrom) |
| Vitinho  | `#6e4824` (marrom-claro) |

## Como rodar

**Claude Design**: anexa foto + cola prompt. Se a primeira saída ainda
estiver realista, pede: *"more chibi, bigger head, smaller body, more
cartoony, like a Nintendo Mii."*

**Midjourney**: `/imagine [URL_DA_FOTO] chibi avatar Xbox Mii style,
big head small body, flat vector cel shading, cream background, full
body, no text --ar 1:1 --style raw --iw 0.8` (`--iw 0.8` deixa o
gerador cartoonizar mais; aumenta pra `1.2` se perder a fisionomia).

**Stable Diffusion (img2img)**: denoise **0.75–0.85** (chibi muda
proporção, precisa de denoise alto). CFG 7–8, 30+ steps.

**DALL-E 3 (ChatGPT)**: cola foto + prompt; sem img2img puro, vai
descrever a pessoa. Pra chibi funciona razoavelmente bem.

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
