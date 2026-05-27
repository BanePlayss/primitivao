# Avatares dos jogadores

Cada jogador tem um PNG **corpo inteiro estilo Cartoon Network anos 2000**
(Dexter's Lab / Codename Kids Next Door / Samurai Jack / Powerpuff Girls).
Estilizado mas com atitude — nada de chibi fofo, nada de fofura kawaii.
Paleta alinhada com o site (bege/laranja/charcoal).

> **Importante:** a cabeça precisa ficar no **terço superior** do PNG.
> O app faz crop nesse topo pra mostrar ícone pequeno na TopBar/comentários,
> e mostra corpo inteiro no perfil/ranking/hall.

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
Transform this photo into a full-body character illustration in the
style of early-2000s Cartoon Network (Dexter's Laboratory, Codename
Kids Next Door, Powerpuff Girls, Samurai Jack — Craig McCracken /
Genndy Tartakovsky influence).

KEEP RECOGNIZABLE: preserve the person's hairstyle, beard, glasses,
skin tone, face shape. Apply cartoon stylization but the character
should clearly read as them.

STYLE:
- Cartoon Network 2000s aesthetic: geometric simplified shapes,
  thick clean outlines, flat color blocks with minimal shading
- Slightly exaggerated proportions: head a bit larger than realistic,
  hands/feet simplified
- Confident or smug expression, with attitude — narrow eyes, smirk,
  or determined look. NOT cute, NOT chibi, NOT wide innocent eyes.
- Standing pose with attitude: arms crossed, hands on hips, slight
  lean, casual stance. NO peace signs, NO waving, NO friendly poses.

PALETTE: cream background #f4ead7, burnt orange #d76414 as accent,
charcoal #1c1612 for outlines. Outfit: simple t-shirt or jersey in
[COLA AQUI A COR DO JOGADOR], plain jeans/shorts, sneakers.

COMPOSITION:
- FULL BODY visible from head to feet
- HEAD POSITIONED IN THE UPPER THIRD OF THE FRAME (critical — gets
  cropped to small icon; face must stay visible)
- Character centered horizontally
- 1:1 square aspect ratio
- Plain cream background, NO floor/shadows under feet, NO other
  elements, NO scene

DO NOT INCLUDE: text, watermark, busy background, photorealistic
textures, anime style, chibi proportions, multiple characters,
weapons, cute decorations, kid-friendly cheerfulness.

Output: PNG 512×512, plain cream or transparent background.
```

### Cor da camiseta + pose sugerida por jogador

| Jogador  | Cor da camiseta             | Pose sugerida                          |
| -------- | --------------------------- | -------------------------------------- |
| Bane     | `#1c1612` (charcoal)        | Braços cruzados, olhar firme           |
| Mohamed  | `#c75418` (laranja queimado)| Mão na cabeça, expressão derrotada     |
| Potato   | `#8b3a14` (marrom-laranja)  | Encostado tipo parede, mão no bolso    |
| Magreza  | `#2a201a` (marrom escuro)   | Pose neutra firme, expressão séria     |
| Celin    | `#e8800f` (laranja vivo)    | Smirk cínico, mão no queixo            |
| Juca     | `#d63c0a` (vermelho-laranja)| Pose triunfante, peito estufado        |
| Caco     | `#4a3020` (marrom)          | Pose relaxada, mão no bolso            |
| Vitinho  | `#6e4824` (marrom-claro)    | Cabeça inclinada, olhar de moleque     |

Adiciona a pose no fim do prompt: *"Pose: [pose acima]"*.

## Como rodar

**Claude Design**: anexa foto + cola prompt. Se a primeira saída
estiver fofa ou anime, pede: *"Less cute, more attitude — like a
Cartoon Network show. Bold geometric shapes, narrow eyes, smirk.
Not anime, not chibi, not children's book."*

**Midjourney**: `/imagine [URL_DA_FOTO] Cartoon Network 2000s style
character, full body, Craig McCracken Genndy Tartakovsky inspired,
bold outlines flat shading, geometric simplified shapes, confident
pose, cream background --ar 1:1 --style raw --iw 0.6` (`--iw 0.6`
deixa o gerador cartoonizar muito; aumenta pra `1.0` se perder
fisionomia).

**Stable Diffusion (img2img)**: denoise **0.78–0.88** (estilo CN
muda proporção bastante). CFG 7–8, 30+ steps.

**DALL-E 3 (ChatGPT)**: cola foto + prompt. Sem img2img puro mas
o estilo CN sai bem porque é icônico.

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
