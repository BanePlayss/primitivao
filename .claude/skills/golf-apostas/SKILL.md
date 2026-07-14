---
name: golf-apostas
description: Como montar/relançar o CARD DE APOSTAS do Golf (GWYF) no Primitivão — modelo de dados, os 4 mercados (ganha/pior/HIO/PAR 3-vias), odds por forma, casada-escalação + anti-correlação, liquidação, launcher do mod e UI. Use SEMPRE que for lançar a S2 do golf, adicionar/mudar mercado do golf, ou mexer nas apostas do golf. Tudo já foi construído e revisado adversarialmente na S1 (2026-07) — isto é o mapa pra repetir sem redescobrir.
---

# Apostas do Golf (GWYF) — Primitivão

> Receita PROVADA na S1 do golf (2026-07, v=golfbet1→golfbet8). Reusa o cupom do
> MK. **Dinheiro de verdade (PC): revisão adversarial é OBRIGATÓRIA antes de
> deployar** (ver §9). Deploy pela skill **build-deploy**; segurança do Firestore
> pela **firestore-safety**; padrão genérico de card pela **card-de-apostas**.
> Tudo mora em `apostas/apostas-app.jsx` (grep os nomes abaixo).

## 0. TL;DR pra relançar a S2
1. Zerar temporada: `gwyf.scores`/`gwyf.props`/`gwyf.finals` viram `{}` (via
   reset — ver §8). Zerar saldos se o dono pedir (§8). NÃO apagar histórico de
   aposta (o dono manteve na S1).
2. Roster novo: `interests.gwyf` (top-level). Reabrir inscrição OU escrever os
   inscritos direto (REST cirúrgico, ver §8). `golfField(interests)` = os nicks.
3. Calendário: `GWYF_SCHEDULE` (6 fixos + 3 aleatórios). Nomes ocultos via
   `gwyfMapLabel`. Se mudar os mapas, mexe aqui.
4. Status do campeonato: `CHAMPIONSHIPS` entry `gwyf` fica `status:'active'`.
5. Código já está pronto — só valida (§9) e deploya. Se for MUDAR mercado/odds/
   casada, refaz a revisão adversarial.

## 1. Modelo de dados (dentro do `json`, via `commitBetDocUpdate`)
- `gwyf.scores[mapN][nick]` = **número** (tacadas reais, SEM teto) | **`'DNF'`**
  (desistiu).
- `gwyf.props[mapN][nick]` = `{ hio: true, par: 'under'|'even'|'over' }` (props do
  mod pra liquidar HIO e PAR).
- `gwyf.finals[mapN]` = `true` → mapa **FINALIZADO** pelo mod → LIBERA a liquidação
  dos cupons daquele mapa (ver §6, portão anti-leak).
- Roster = **`interests.gwyf`** (campo TOP-LEVEL, fora do json — `.set(merge:true)`).
  Helper `golfField(interests)` = `Object.keys(interests.gwyf).sort()`. **NÃO filtra
  por `mkIsWithdrawn`** (isso é do MK; contaminava o campo — bug corrigido).
- State no App: `golfScores`/`golfProps`/`golfFinals` + loaders (no `onSnapshot`) +
  ações do mod `setGolfStrokes`/`setGolfDnf`/`setGolfProp`/`setGolfFinal` (cada uma
  faz `commitBetDocUpdate` mantendo os siblings de `gwyf`).

## 2. Os 4 mercados (por rodada/mapa)
`GOLF_MARKETS = ['WIN','LOSE','HIO','PAR']`. `GOLF_FIELD_MARKETS = ['WIN','LOSE']`.
`GOLF_SIMPLES = ['WIN','LOSE']` (o resto é AVANÇADO). Textos em `GOLF_MKT_TITLE`/
`GOLF_MKT_SHORT`/`GOLF_MKT_SUB`.
- **WIN** "QUEM GANHA A RODADA?" — menos tacadas. Mercado de CAMPO, **seleção ÚNICA**
  (só 1 vencedor por rodada).
- **LOSE** "QUEM VAI SER O PIOR?" — mais tacadas. Campo, **seleção ÚNICA**.
- **HIO** "ACERTA ALGUM HOLE IN ONE?" — SIM/NÃO por jogador (prop `hio`).
- **PAR** "TERMINA ABAIXO / NO PAR / ACIMA?" — **3 vias** por jogador. `GOLF_PAR_SIDES`
  = `[{k:'ABAIXO',par:'under',def:0.33},{k:'PAR',par:'even',def:0.12},{k:'ACIMA',
  par:'over',def:0.55}]`. Helpers `golfParOf(side)`/`golfParLabel(par)`. O mod marca
  `prop.par` de cada jogador que completou.

> Histórico: a S1 já teve FINISH (completa/desiste), HALFDONE (completa metade) e
> HALFPAR (metade abaixo do par) — foram DROPADOS quando o dono redefiniu pros 4
> acima. Se for readicionar, o padrão Sim/Não é `golfSimProb`+`golfSideOdd`.

## 3. Odds (margem da casa embutida, SEM piso)
`golfOdd(p) = 1 + (1/p - 1)*0.85` → EV = 0.85 + 0.15·p < 1 pra todo p<1 (a favor da
casa). **NÃO tem piso** — um piso fixo (ex 1.10) virava +EV pro apostador em prob
alta (bug crítico corrigido). Retorna `null` se a odd < 1.02 (quase-certo não é
oferecido) e SEM teto (azarão paga alto).
- Campo: `golfWinProbs(schedule,scores,players)` (força = 1/média de tacadas,
  normalizado; parelha 1/N sem histórico). `golfLoseProbs` = `golfWinProbs(...,true)`
  (invert, força = média).
- PAR: `golfParProb(schedule,scores,props,nick,target)` (taxa do resultado sobre
  mapas completados, blend com default). `golfParOdd` = `golfOdd(golfParProb)`.
- HIO: `golfSimProb('HIO',...)` (taxa de hio, default 0.05) → `golfSideOdd(p,side)`
  = `golfOdd(side==='NAO' ? 1-p : p)`.

## 4. Casada = ESCALAÇÃO (uma perna por jogador) + ANTI-CORRELAÇÃO
Só a RODADA ATUAL é apostável (§7) → toda casada é do MESMO mapa (mesmo evento) →
**pernas correlacionadas**. Regras (cliente `toggle` + servidor `placeGolfBet`, MESMA
lógica em `golfCasadaReject`):
- **Uma perna por (mapa, jogador)** (`seenPP`): clicar outro mercado/via no mesmo
  jogador TROCA o papel dele. Bloqueia empilhar palpites correlacionados no mesmo cara.
- **WIN/LOSE = seleção única**: `golfCasadaReject` recusa 2+ WIN ou 2+ LOSE. No
  cliente o `toggle` troca (não empilha).
- **Bundles comonotônicos BLOQUEADOS** (`golfCasadaReject`): (a) WIN + LOSE juntos
  (exclusão de extremos — quase a mesma aposta), (b) 2+ PAR do MESMO lado (mapa fácil
  = muita gente abaixo junto).
- **Desconto de correlação no PAGAMENTO** (`golfCasadaOdd`): `combinado = 1 +
  (produto - 1) * GOLF_CASADA_CORR^(nPernas-1)`, `GOLF_CASADA_CORR = 0.7`. Aplicado
  no DISPLAY do cupom **E** no settle (baseado em `nWin` — pernas ganhas, void não
  conta). Cobre o fator "dificuldade de mapa" que deixaria WIN+PAR:under etc. +EV.

## 5. placeGolfBet (recompute no servidor)
`placeGolfBet({legs:[{market,pick,side,mapN}], stake})`. Dentro do
`commitBetDocUpdate`:
- Roster AUTORITATIVO: `golfField(ti || remote.interests)` — o 2º arg `ti` do reducer
  é o `topInterests` real (NUNCA o closure do cliente; era adulterável).
- **Recomputa CADA odd** do placar/props remotos (nunca confia na odd do cliente).
- **Sem apostar em si mesmo** (`pick === nick` recusa). Também na CÓPIA da Mesa:
  `copyOpenTicket` recusa se você é um `pick` do cupom; e `legBusy` fecha a cópia de
  cupom do golf quando o mapa começou (`golfMapPlayed`).
- Fecha a aposta no 1º lançamento do mapa: `golfMapPlayed(scores,mapN,players)`.
- Aplica `golfCasadaReject` + `golfCasadaOdd` (§4). Perna: `fixtureId
  'gwyf:<market>:<mapN>:<pick>'`, guarda `odd`.

## 6. Liquidação (portão `finalized` — anti-leak)
Effect com deps `[golfScores, golfProps, golfFinals, bets]`, debounce ~650ms.
- **SÓ liquida quando o mod FINALIZA** o mapa (`gfinals[mapN]`), não no 1º placar.
  Sem esse portão, digitar o 1º placar liquidava WIN/LOSE em cima de dado parcial e
  pagava prêmio fantasma reversível → **leak de PC** (bug HIGH corrigido). Idem props
  "NÃO" pagando antes do mod marcar.
- `golfLegResult(market,pick,side,mapN,scores,props,players,finalized)`: `!finalized`
  → pending. WIN/LOSE: se o pick não postou número (DNF/ausente) → **void**; senão
  win se está no argmin/argmax. HIO: prop `hio` vs side. PAR: DNF ou `!prop.par` →
  void; senão `prop.par === golfParOf(side)`.
- Parlay: pending se alguma pending; lost se alguma lose; void se TODAS void; senão
  won. **Perna void → odd 1.0** (não derruba a casada). Pagamento = stake ×
  `golfCasadaOdd(produto-das-ganhas, nWin)` × bônus-dia-oficial. Reconcilia
  (idempotente por status+payout+bônus; estorna o pagamento anterior exato se o mod
  corrigir).

## 7. UI (GolfBettingView — reusa o cupom do MK)
- **Só a RODADA ATUAL aparece**: `activeRound` = 1ª rodada com `!golfFinals[n]`. As
  próximas só abrem quando o mod FINALIZA a atual. `bettingOpen` = mapa nem começou.
  Estado "EM ANDAMENTO" quando fecha mas não finalizou.
- **Cupom = gaveta flutuante do MK**: `.mk-cupom-wrap` (fica escondida em
  `translateY(135%)`), aberta pela **barra `.mk-betbar` "VER CUPOM"** (aparece com
  1+ palpite) + `.cupom-sheet-backdrop`. SEM a betbar a gaveta não aparece (bug que
  já pegou 2x). Abas SIMPLES/AVANÇADO (`betMode`).
- **Card = ABAS de mercado** (`.golf-tab`, um mercado por vez — NÃO acordeão, que dava
  scroll infinito). WIN/LOSE em grid compacto (`.golf-grid`/`.golf-cell` com odd
  grande + "escalado: X" quando o jogador já tem papel). HIO/PAR em linhas
  (`.golf-rows`/`.golf-pick`, PAR com 3 botões). Header de evento `.golf-event`.
- `legSummary` (Mesa) e o display do cupom têm branch por mercado do golf (PAR mostra
  `golfParLabel`, HIO SIM/NÃO). CSS em `styles.css` (grep `.golf-`).

## 8. Virada de temporada (S1 → S2)
- **Zerar saldos** (se o dono pedir): `zeroAllPc` (ADMIN→MOD→USUÁRIOS→ZERAR SALDOS) ou
  REST cirúrgico do campo `json` (round-trip lossless, `pc=0` em todos — tamanho ~igual
  passa o `notWipingJson`). Ver [[saldos-legitimos-e-exploit-cashback]].
- **Histórico de aposta**: o dono MANTEVE na S1 (as apostas antigas são liquidadas, não
  atrapalham; apagar esbarra no `notWipingJson` — bets são ~93% do doc — e some o REI
  DAS APOSTAS). Confirmar com o dono antes de apagar qualquer coisa.
- **Reset do jogo**: `gwyf.scores/props/finals = {}`. Roster novo em `interests.gwyf`
  (REST PATCH com `updateMask.fieldPaths=interests.gwyf.<nick>`, valor
  `{mapValue:{fields:{at:{integerValue:"<ts>"}}}}`; SEMPRE backup antes — o doc é de
  escrita pública gateada só pelas rules). Ex.: potato foi adicionado assim na S1.
- **Fim da season**: premiar via skill **finalizar-campeonato** (troféus/títulos, REI
  DAS APOSTAS, vexame) — a classificação do golf é `computeGolfStandings`.

## 9. Validar + revisão adversarial + deploy (OBRIGATÓRIO)
1. **Lógica pura testada** em node ANTES de integrar: `scratchpad/golf-bet-logic2.js`
   (mercados), `golf-integration.js` (placeBet+settle+reconcile), `golf-par-test.js`
   (PAR+casada+anti-correlação). Rode e confirme os asserts (EV<1 em todo mercado/via).
2. **Revisão adversarial** (Workflow, lentes EV/exploit + settlement + state-tx +
   correlação) SE mexer em dinheiro. Na S1 achou e corrigiu: piso da odd (+EV),
   settle parcial (leak), `mkIsWithdrawn` contaminando o campo, e casada
   correlacionada (WIN+LOSE / same-side PAR). Verifica cada finding adversarialmente
   antes de aceitar.
3. Parse OK (CLAUDE.md §4) + sem emoji (skill `icons`).
4. Bump `?v=` (3 pontos) + esbuild + commit BanePlayss + rebase-sobre-o-bot + push
   (skill **build-deploy**).
5. **Preview**: screenshots dão timeout aqui — use `read_page`/`javascript_tool` pra
   ler estrutura/estado (skill **preview-verify**). Confirma: abas dos mercados,
   PAR 3-vias, cupom abrindo pela betbar, casada com desconto, bloqueio WIN+LOSE.
6. Ctrl+Shift+R pro dono.

## Constantes/símbolos pra grepar
`GOLF_MARKETS GOLF_FIELD_MARKETS GOLF_SIMPLES GOLF_MKT_TITLE GOLF_MKT_SHORT
GOLF_MKT_SUB GOLF_PAR_SIDES GOLF_DEF GOLF_CASADA_CORR golfField golfOdd
golfWinProbs golfLoseProbs golfParProb golfParOdd golfSimProb golfSideOdd
golfParOf golfParLabel golfMapPlayed golfMapFinal golfMapWinners golfMapLosers
golfLegResult golfCasadaReject golfCasadaOdd golfPlayerForm computeGolfStandings
computeGolfMapStandings placeGolfBet setGolfStrokes setGolfDnf setGolfProp
setGolfFinal GolfBettingView GolfView GWYF_SCHEDULE gwyfMapLabel`
