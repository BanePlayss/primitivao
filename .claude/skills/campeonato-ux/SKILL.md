---
name: campeonato-ux
description: A ESTRUTURA PADRÃO da tela de um campeonato no Primitivão (aba CAMPEONATOS) — duas colunas com CLASSIFICAÇÃO e RODADAS, trilho de rodadas, cards de confronto e o quadro de mata-mata. Use SEMPRE que for criar ou mexer na view de qualquer campeonato (LoL, RL, CS, Valorant, TFT, Pokémon, Magic, Crab Game, FIFA S2...). Referência viva: LolView + MkChampionshipView no apostas-app.jsx.
---

# Tela de campeonato — a estrutura padrão (Primitivão)

> Padrão fechado em 2026-08-11 com a `LolView`, depois do dono comparar lado a
> lado com o MK. **Todo campeonato novo nasce com esta estrutura.**
> A tela de APOSTAS (cupom, mercados, odds) é outra coisa: skill **cupom-ux**.
> Ciclo soon→active→closed e prêmios: **championship-lifecycle**.

## 0. A divisão que sustenta tudo

Duas superfícies, com papéis que não se misturam:

| aba | o que é | quem usa |
|---|---|---|
| **CAMPEONATOS** | o campeonato: classificação, rodadas, chaveamento | todo mundo lê · o mod lança resultado |
| **APOSTAS** | só apostar: cards de mercado + cupom | quem vai apostar |

Nunca jogue a classificação inteira dentro de APOSTAS (já foi feito e o dono
devolveu na hora) nem o cupom dentro de CAMPEONATOS. Se o usuário quer ver *o
que aconteceu*, ele vai em CAMPEONATOS. Se quer *arriscar PC*, vai em APOSTAS.

## 1. Esqueleto — duas colunas, nunca empilhado

```jsx
<>
  {/* banner de campeão FORA do grid — dentro vira célula e desloca as colunas */}
  {finalOrder && <div className="...-champ-banner">…</div>}

  <div className="grid mk-grid">
    <div className="card mk-card">…CLASSIFICAÇÃO…</div>
    <aside>
      <div className="card mk-card mk-rodada-card">…RODADAS…</div>
      <div className="card mk-card mk-rodada-card">…MATA-MATA…</div>
    </aside>
  </div>
</>
```

`grid mk-grid` é o que existe no CSS (`.champ-main .mk-grid` = `1fr /
minmax(360px, 1.35fr)`, empilha sozinho abaixo de 1180px). **Não invente
wrapper**: um `.mk-champ` inventado já derrubou o layout pra uma coluna só e
virou scroll longo — e o erro passou porque eu olhei a marcação em vez do
`getComputedStyle`.

As rodadas ganham MAIS largura que a classificação (1.35 vs 1) de propósito: é
lá que estão os cards com avatar, placar e o lançador do mod.

## 2. Coluna esquerda — CLASSIFICAÇÃO

Ordem fixa, de cima pra baixo:

**a) `card-head`** — `title` com ícone do jogo + `sub` com o CONTEXTO, não com
o óbvio. "10 INSCRITOS · TOP 8 VAI PRO MATA-MATA" responde "o que está em jogo",
que é a pergunta real de quem abre a tela.

**b) `.mk-admin-row` + `.mk-admin-note`** — uma frase dizendo o que a tela é. O
texto MUDA por papel:
- jogador: "Classificação oficial — atualiza sozinha conforme os placares saem."
- mod: o que ele tem que fazer ("lance o vencedor e a forma de cada partida").

Do lado, `.mk-admin-actions` com o que couber (inscrição, sortear, republicar).

**c) `.std-table mk-std-table`** — colunas curtas (`J V E D` + o saldo do jogo +
`P`). A **posição** usa `.mk-pos-cell` com `borderLeftColor`/`color` de
`MK_TOP8_COLORS`: pódio 1-2-3 com cor própria, zona de classificação numa cor
só, resto sem cor. Isso comunica a disputa **sem ler nada**.

**d) sub-linha por jogador** (`.mk-row-chars`) — o slot de identidade do
campeonato. No MK são os 3 personagens; no LoL, a situação na chave
("BYE NA SEMIFINAL", "classificado") + aproveitamento. **Nunca deixe vazio**:
se o jogo não tem nada característico, use aproveitamento, forma recente ou
"ainda não jogou".

**e) `.mk-legend`** — as regras em 2-3 linhas: como pontua, como desempata, quem
classifica. É o que evita a pergunta no Discord.

## 3. Coluna direita — RODADAS

**a) `card-head`**: "RODADA NN" + a fase (TURNO/RETURNO, FASE DE GRUPO...).

**b) `.mk-rnav`** — seta ‹ · fase + contador `N / total` · seta ›.

**c) `.mk-rstrip`** — pílulas numeradas de TODAS as rodadas, agrupadas por fase
com `.mk-rstrip-lab`. Estado por classe: `mk-rchip-done` · `mk-rchip-live` ·
`mk-rchip-future`, mais `sel` na atual. Navegar 20 rodadas com seta é ruim; com
o trilho, o usuário salta direto e ainda **vê o progresso do campeonato**.

**d) `.mk-rstrip-leg`** — legenda (encerrada / atual / a vir) + o contador
"N/M jogos". Bolinha colorida sem legenda é charada.

**e) `.mk-fixtures`** com um `.mk-fx` por confronto:

```jsx
<div className={'mk-fx' + (done ? ' done' : '') + (mine ? ' mine' : '')}>
  <div className="mk-fx-top">
    <span className="mk-fx-jogo">JOGO 01
      {mine && <span className="mk-fx-mine"><Icon name="…" size={10} /> SEU JOGO</span>}
    </span>
    {done && <span className="mk-fx-done"><Icon name="check" size={11} /> 2×0</span>}
  </div>
  <div className="mk-fx-body">
    …avatar + nick de cada lado, com .win/.lose no vencedor, .mk-fx-vs no meio…
  </div>
  {/* detalhe do formato: as partidas do MD2, os rounds do MK, os mapas… */}
  {isMod && <div className="…-mod">…lançador inline…</div>}
</div>
```

Duas regras que valem pra todo campeonato:

- **SEU JOGO vai pro topo** (`.sort` por `isMine`) e ganha borda. A primeira
  coisa que o jogador procura é o jogo dele.
- **O mod lança DENTRO do card**, não num painel separado. Ele já está olhando o
  confronto; mandar procurar outro lugar é atrito puro.

## 4. Mata-mata — card próprio

Card separado, com as fases rotuladas (QUARTAS / SEMIFINAL / DECISÃO) e um
`.mk-fx` por confronto. Confronto que ainda depende de outro mostra os lados
como `—` e um rodapé "aguardando o jogo anterior" — **nunca some da tela**: o
jogador quer ver o caminho dele até a final antes de ele existir.

## 5. Estado vazio nunca é beco sem saída

Todo bloco vazio explica **o que destrava**, e mostra o botão se quem está
olhando pode destravar:

- sem inscritos → "Ninguém inscrito ainda" + botão de inscrição
- sem tabela → "sai sozinha dos inscritos, faltam jogadores"
- mata-mata fechado → "abre quando a fase de grupo terminar" ou, se já terminou
  e quem olha é mod, o botão **PUBLICAR MATA-MATA**

Use `.mk-sorteio-empty` + `.mk-sorteio-ic` + `.tp-btn-go`, ou `.empty` com
`.e1`/`.e2` dentro de tabela.

## 6. Princípios (o porquê, pra decidir o que a receita não cobre)

1. **Contexto antes de dado.** Todo cabeçalho responde "o que está em jogo".
2. **Revelação progressiva.** Resumo → detalhe. O card fechado já decide; o
   aberto aprofunda.
3. **Estado sempre visível.** Encerrada/atual/a vir, APOSTAS FECHADAS, SEU JOGO.
   O usuário nunca deve adivinhar em que momento o campeonato está.
4. **O que é seu vem primeiro.** Seu confronto no topo, sua linha destacada.
5. **Cor carrega significado, não decoração.** Zona de classificação, vencedor,
   estado da rodada. Se a cor não significa nada, tire.
6. **Ação onde o olho já está.** Mod lança no card do confronto.
7. **Vazio é instrução.** Diz o que falta e quem pode resolver.

## 7. Checklist de campeonato novo

1. `grid mk-grid` com `<div className="card mk-card">` + `<aside>`? (conferir o
   `getComputedStyle` do grid, não só a marcação)
2. Banner de campeão FORA do grid?
3. `card-head` com contexto de verdade no `sub`?
4. Faixa `.mk-admin-note` com texto por papel?
5. Tabela com zona colorida na posição + sub-linha preenchida?
6. `.mk-legend` com pontuação, desempate e quem classifica?
7. `.mk-rnav` + `.mk-rstrip` com estado + legenda com contador?
8. `.mk-fx` com SEU JOGO no topo e destacado, e lançador do mod inline?
9. Mata-mata em card próprio, com confronto futuro visível?
10. Todo estado vazio explica o que destrava?
11. Legível nos DOIS temas? (elemento SOLTO no fundo não segue a regra do
    charcoal — ver cupom-ux §7)
12. Verificado no preview medindo o container que deveria ter mudado — não
    procurando texto na página inteira. Esse atalho já deixou passar uma view
    errada e uma aba quebrada no mesmo dia.

## 8. Referências no código

- `LolView` — a implementação de referência deste padrão
- `MkChampionshipView` / `renderKoCard` — a origem das classes
- `GolfView` — variação com rodadas por mapa
- CSS: `.mk-grid`, `.mk-card`, `.mk-std-table`, `.mk-pos-cell`, `.mk-row-chars`,
  `.mk-legend`, `.mk-rnav`, `.mk-rstrip`, `.mk-rchip`, `.mk-fixtures`, `.mk-fx`,
  `.mk-sorteio-empty` — todas já existem, nenhuma precisa ser criada
