---
name: championship-lifecycle
description: Como abrir, rodar, ENCERRAR e PREMIAR um campeonato no Primitivão (apostas/apostas-app.jsx). Use SEMPRE que o Lucas pedir pra "abrir/começar", "encerrar/fechar" ou "dar os prêmios/títulos" de um campeonato (FIFA, MK, Golf/GWYF, RL, LoL, CS...). Encoda onde vive cada dado, o ciclo soon→active→closed, e como os títulos/troféus (campeão, vice, vexame/lanterna, REI DAS APOSTAS) são conquistados — pra não se perder cada vez.
---

# Ciclo de vida de um campeonato — Primitivão

> Fonte de verdade pra "abrir / rodar / encerrar / premiar" qualquer campeonato.
> Toda mudança de código segue a skill **build-deploy** (validar → bump `?v=` →
> esbuild → commit → rebase-sobre-o-bot → push). Escrita ao vivo segue a skill
> **firestore-safety**. Sem emojis na UI (skill **icons** + CLAUDE.md §1).

## 1. O que é um campeonato (modelo de dados)

A lista dos campeonatos é **hardcoded** em `CHAMPIONSHIPS` (~linha 141 do
`apostas-app.jsx`): `{ id, name, season, tag, status }`. Ex: `fifa`, `mk`,
`gwyf` (golf), `rl`, `lol`, `cs`, `valorant`, `tft`, `pokemon`, `magic`, `crab`,
`fifa2`. O `status` estático é só `'active'` ou `'soon'` — **`'closed'` é
CALCULADO** (ver §2), não fica no array.

**Cada jogo guarda os dados em lugar DIFERENTE** (isso é o que mais confunde):

| Campeonato | Dados dos jogos/resultados | Inscrição |
|---|---|---|
| **FIFA** | `cs` = doc `primitivao/state` (`cs.rounds`, ida/volta por teamId→nick) | tem time no `teamPlayers` |
| **MK** | `json.mk` no doc `primitivao/apostas`: `{ draw, scores, ko }` — `draw`/`scores` = LIGA (round-robin, 14 jogadores), `ko` = MATA-MATA (top-8, `{published, seeds, scores, lineups}`) | `interests.mk` (top-level) |
| **Golf (GWYF)** | hoje só preview (`GWYF_SCHEDULE`, `GolfView`); motor de pontuação a construir | `interests.gwyf` (top-level) |
| resto (`soon`) | nada ainda | `interests.<id>` |

`interests`, `comments`, `worldcup`, `news`, `discord_webhook` são campos
**TOP-LEVEL** (irmãos do `json`), escritos com `{merge:true}` — NUNCA entram no
reducer do `json` (firestore-safety).

## 2. Status / ciclo de vida: `soon → active → closed`

`champStatusFor(c, cs)` (~6151) devolve o grupo do campeonato:
- `c.status === 'active'` → chama `computeChampStandings(c.id, cs)`; se `.status
  === 'closed'` → **`'closed'`**, senão `'active'`.
- senão → `'soon'`.

`computeChampStandings(champId, cs)` (~14617) **só entende FIFA** hoje
(`if (champId !== 'fifa') return {status:'soon'}`). FIFA vira `'closed'` quando
**todas** as rodadas do `cs.rounds` foram jogadas. Isso alimenta: agrupamento no
sidebar (`ChampSidebar`, grupos ATIVOS/ENCERRADOS/EM BREVE), `isBettableChamp`
(`champStatusFor(active,cs)==='active'` → §4), troféus de medalha
(`trophiesForNick`), e o REI DAS APOSTAS (`betKingChamps`/`bettingSeasonRanks`).

**Consequência prática:** pra um jogo NÃO-FIFA (MK, golf) "fechar de verdade" por
esse caminho, o `computeChampStandings` precisaria enxergar os dados dele — e
esses dados NÃO estão no `cs` (estão no `json.mk` / `interests`). Ver §5 (MK) e §6
(golf) pros caminhos reais usados.

## 3. Abrir / começar um campeonato

1. **Flip do status**: `soon → active` no `CHAMPIONSHIPS` (~141). Só isso já faz
   `isBettableChamp` virar `true` — **então NÃO flipe sem o motor pronto**, senão
   a aba APOSTAS mostra um campeonato "apostável" sem nada pra apostar.
2. Construir/garantir o motor daquele jogo: view própria (tipo `GolfView`/MK),
   lançador de placar pro mod, classificação, e — se for apostável — mercados +
   odds + slip + liquidação (mirror do MK/FIFA).
3. Inscrição já funciona via `interests.<id>` (banner "QUERO PARTICIPAR") mesmo
   em `soon`.
4. **Não deixe DOIS campeonatos apostáveis órfãos**: o app escolhe o
   `firstBettableChampId` (primeiro `active`) como default. Fechar um e abrir
   outro é UMA transição (§7).

M8/M8b: existe um sistema paralelo de campeonatos criados pelo admin no doc
SEPARADO `primitivao/championships` (`createChampionship`, ~3575) — NÃO confundir
com o array estático `CHAMPIONSHIPS`. FIFA/MK/golf são do array estático.

## 4. Rodar (placares + apostas)

- **Placar**: o mod lança pelo `ResultLauncherPanel` (~868) / views próprias.
  MK-liga usa `mk.draw`+`mk.scores`; MK-KO usa `mk.ko.scores` (MD5, `setMkKoGame`
  /`setMkKoField`/`setMkKoLock`). FIFA usa `cs.rounds`.
- **Aposta**: `placeMkBet`/`placeBet` → `commitBetDocUpdate`. Legs carregam
  `champId` (`'fifa'`, `'mk'`, `'mkko'` no KO). Liquidação automática nos effects
  que varrem `bets` quando o placar muda. Cada `champId` tem seu ranking de
  apostas independente (`seasonBettingRanking`).
- Fechar aposta por confronto: `mkGameClosed`/`mkKoConfrontoClosed` (trava dura
  `locked` ou cronômetro `lockAt`, 30s).

## 5. Encerrar + PREMIAR — como foi feito no MK (2026-07)

> Decisão do dono (Lucas): ao encerrar, **NÃO dar PC** ("não recebe valor
> nenhum, as apostas zeram"). As apostas só liquidam normalmente. O prêmio é
> **TÍTULO/TROFÉU**: campeão, vice, 3º, **vexame pro último**, e **título da
> aposta** (REI DAS APOSTAS). Ver [[saldos-legitimos-e-exploit-cashback]] (nunca
> mintar/resetar PC sem pedido explícito).

### 5.1 Sistema de títulos/conquistas (é assim que se "dá um troféu")

NÃO existe botão de "conceder título". Título = **predicado auto-calculado** e
depois **latchado** (permanente). Dois arquivos-fonte:
- `ACH` (~9802): objeto de predicados `(ctx) => bool`. `ctx` tem
  `{nick, bets, users, teamPlayers, cs, worldcup, interests, comments, mk}`.
- `ACHIEVEMENTS` (~9874, alias `TITLE_DEFS`): `{id, name, icon, rarity, check:
  ACH.xxx}`. O `id` persiste em `users[nick].earnedTitles`.

`titlesForNick(nick, ctx)` (~10230): roda os `check` ao vivo + junta os já
latchados. O **latch** (effect ~5592) grava os novos do usuário LOGADO em
`earnedTitles` (fica permanente mesmo se a condição mudar). Equipar (aparece do
lado do nick) = `users[nick].title` via `setSelectedTitle`.

→ Pra "dar o título do campeão", faça o **predicado apontar pro vencedor real**.
Não hardcode nick (o campeonato repete) — derive do resultado.

### 5.2 Títulos do MK já existem (via `mkStatsFor`)

`mkChamp`/`mkVice`/`mkBronze`/`mkLast`(SACO DE PANCADA)/`mkFlawless` leem
`mkStatsFor(nick, ctx)` (~9721). O `mkStatsFor` calcula a **classificação final**:
- Se o **KO fechou** (`mkKoPodiumOrder(mk.ko)` != null — final + disputa de 3º
  decididas): pódio = KO (campeão=`F.winner`, vice=`F.loser`, 3º=`T3.winner`,
  4º=`T3.loser`); o RESTO ordenado pela liga (`computeMkStandings`). `isLast` =
  lanterna entre quem JOGOU (j>0) — o "vexame".
- Senão: cai na classificação da liga (quando todas as partidas acabaram).
- Precisa de `ctx.mk.ko` — adicionado no `ccCtx` (~5412): `mk:{draw,scores,ko}`.

### 5.3 REI DAS APOSTAS ("título da aposta") por campeonato

`rei_apostas`/`vice_apostas`/`mico_apostas` (predicados `betKing`/`betVice`/
`betMico`) leem `bettingSeasonRanks(nick, cs, bets, mkClosed)` (~9638): pra cada
campeonato FECHADO, rankeia por LUCRO (`payout-amount`). O MK não passa pelo
`computeChampStandings`; por isso o predicado passa `mkClosed =
!!mkKoPodiumOrder((mk).ko)`. `mico_apostas` = pior apostador (no vermelho) = mais
um "vexame".

### 5.4 O que FALTA pra encerrar 100% (não feito no MK ainda)

Fazer `champStatusFor('mk')` e `computeChampStandings('mk')` devolverem `'closed'`
desbloquearia: grupo ENCERRADOS no sidebar, parar a aposta, medalhas
`trophiesForNick` do MK, e o REI via `betKingChamps` (display por-campeonato).
Custo: `computeChampStandings` é chamado em ~20 lugares como `(champId, cs)` sem os
dados do MK — threadear é largo, OU usar um ref de módulo setado pelo App. As
vitrines (`buildShowcase`/`ShowcaseItem`) assumem teamId (FIFA); pra MK (por nick)
precisa adaptar avatar/cosmetics. Por isso o MK só ganhou os TÍTULOS (via
conquistas) primeiro; o flip de status junta com a virada de temporada (§7).

## 6. Golf (GWYF) — formato e o que construir

`GWYF_SCHEDULE` (~6215): **stroke play coletivo**, 9 rodadas, cada rodada é um
MAPA; no dia todos os inscritos jogam o MESMO mapa; menor nº de tacadas vence
(teto `GWYF_MAX_STROKES = 12`; não-completou conta o teto). Mapas fixos ficam
OCULTOS (`gwyfMapLabel`). Hoje `GolfView` (~6270) é só preview (classificação
zerada + calendário "AGUARDANDO"). Abrir de verdade = construir: lançador de
tacadas por mapa (mod), classificação por mapa + geral, e mercados de aposta
(vencedor do mapa, campeão da temporada...) espelhando o MK. Ver
[[golf-gwyf-launch-preview]].

## 7. Virada de temporada (encerrar A + abrir B)

Fechar um apostável e abrir outro é UMA operação — senão o app fica sem
`firstBettableChampId` coerente. Ex: MK→closed + golf→active juntos. Faça o flip
de status + garanta o motor do novo pronto ANTES do flip.

## Gotchas
- `computeChampStandings` = FIFA-only. Não assuma que sabe de MK/golf.
- Títulos latcham no **login de cada jogador** (não retroativo global na hora):
  o campeão vê o título quando abrir o app. Igual FIFA sempre foi.
- Números de linha aqui são DICAS — confirme por `grep` do nome da função (o
  arquivo tem ~17k linhas e muda).
- Sem PC de prêmio sem pedido explícito. Sem emoji na UI.
