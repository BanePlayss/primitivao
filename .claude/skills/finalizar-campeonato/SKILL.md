---
name: finalizar-campeonato
description: Passo-a-passo pra ENCERRAR um campeonato do Primitivão e dar os PRÊMIOS (troféus/medalhas, títulos/conquistas, REI DAS APOSTAS). Use SEMPRE que um campeonato ACABAR (o Lucas disser "encerra o X", "acabou o X", "dá os prêmios/troféus do X"). Receita concreta e testada (MK 2026). NÃO dá PC de prêmio. Complementa a skill championship-lifecycle (o mapa amplo).
---

# Finalizar campeonato + dar prêmios — Primitivão

> Receita PROVADA no encerramento do MK (2026-07). Rode item por item.
> Prêmio = **TROFÉU + TÍTULO**, **nunca PC** (regra do dono — ver
> [[saldos-legitimos-e-exploit-cashback]]). Deploy pela skill **build-deploy**.
> Mapa amplo do ciclo: skill **championship-lifecycle**.

## Regra de ouro
- **SEM PC de prêmio.** "As apostas zeram" = elas só liquidam normal (o ranking
  de aposta é por-campeonato, o próximo já nasce zerado). NÃO apagar histórico de
  aposta (sustenta o REI + as conquistas de aposta).
- Prêmio de colocação = **TROFÉU** (medalha: champion/vice/terceiro/lanterna/
  penultimo/participou) + **TÍTULO** (conquista equipável: CAMPEÃO DO X etc.).
- Confirme com o Lucas quais lugares premiar se não for o padrão (campeão + pódio
  + vexame pro último).

## Passo 1 — a CLASSIFICAÇÃO FINAL (quem ficou onde)
Cada jogo decide o lugar de um jeito. Precisa de uma ORDEM final dos jogadores:
- **FIFA**: tabela de pontos corridos (`computeChampStandings('fifa', cs)` /
  `computeStandings(cs.rounds)`).
- **MK**: **mata-mata decide o pódio** + resto pela liga → `mkFinalOrder(players,
  concluded, ko)` (pódio do KO `[F.winner, F.loser, T3.winner, T3.loser]` via
  `mkKoPodiumOrder` + resto por `computeMkStandings`). "último"/vexame = lanterna
  de quem JOGOU (j>0).
- **Golf/novos**: a classificação da temporada daquele jogo.

**TESTE antes de premiar** (o padrão do repo): extrai as funções puras +
os dados AO VIVO (REST, ver firestore-safety) e roda um node assertando quem é
campeão/vice/3º/último. Ex.: `scratchpad/mktrophy-test.js` (ivansf=champion,
mohamed=vice, celin=terceiro, oldspriggan=lanterna). NÃO deploya coroando o
jogador errado.

## Passo 2 — FECHAR o campeonato (vai pro grupo ENCERRADOS + trava aposta)
`champStatusFor(c, cs)` decide o grupo (ATIVOS/EM BREVE/ENCERRADOS) e o
`isBettableChamp`. FIFA fecha sozinho (todas as rodadas jogadas). **Jogo que não
passa pelo `computeChampStandings`** (só entende FIFA) precisa de atalho:
- MK: `champStatusFor` tem `if (c.id === 'mk') return mkKoPodiumOrder((_mkChampData||{}).ko) ? 'closed' : 'active'`.
- `_mkChampData` = ref de módulo `{draw,scores,ko,players}` setado no CORPO do
  render do App (fresco antes dos filhos) — evita threadear o dado por ~20
  call-sites. Replica esse padrão pro próximo jogo.
- **Virada de temporada**: fechar A e abrir B é UMA operação (senão o app fica sem
  `firstBettableChampId` e a aba APOSTAS mostra um encerrado). Ver §7 da
  championship-lifecycle.

## Passo 3 — TROFÉUS (medalhas)
`trophiesForNick(nick, cs, teamPlayers)` roda os campeonatos e dá kind
champion/vice/terceiro/participou/penultimo/lanterna. **É FIFA-gated** via
`computeChampStandings`. Pra um jogo não-FIFA, adiciona um **special-case leve**
(o que fiz no MK, evita mexer no computeChampStandings + vitrine teamId):
```js
for (const c of CHAMPIONSHIPS) {
  if (c.id === 'mk') { const k = mkTrophyForNick(nick, _mkChampData); if (k) trophies.push({champId:'mk', kind:k}); continue; }
  ... (FIFA normal)
}
```
`mkTrophyForNick(nick, data)` mapeia a `mkFinalOrder` pros kinds (idx 0=champion,
1=vice, 2=terceiro se n>3, n-1=lanterna, n-2=penultimo, resto=participou). Copia
essa regra pro novo jogo. Os troféus aparecem sozinhos na seção **TROFÉUS** do
perfil (`MeuPerfilView`), da **ESTATÍSTICAS** (`DetailedStatsCard`) e no
`PlayerProfileModal`, via `TrophyGroup`.

## Passo 4 — TÍTULOS (conquistas equipáveis)
As conquistas de colocação já existem em `ACH`/`ACHIEVEMENTS` (`mk_campeao`,
`mk_vice`, `mk_bronze`, `mk_lanterna`, `champion`/`vice`/`lanterna` da FIFA...).
Elas leem stats via predicado. **Garanta que o predicado enxerga o resultado
certo**: no MK, `mkStatsFor` precisa de `ctx.mk.ko` — e TODO contexto que monta
`mk:{draw,scores}` pra título precisa incluir `ko`: `ccCtx` (latch), a
`EstatisticasView`, o `setSelectedTitle` (equipar) e o `setUserCosmetic`. Título
LATCHA no login de cada jogador (permanente em `earnedTitles`) — não é retroativo
global; o campeão vê ao abrir o app.

## Passo 5 — REI DAS APOSTAS (título da aposta)
Um por season fechada (mais LUCRO nas apostas daquele `champId`). `betKingChamps`
e `bettingSeasonRanks` gateiam por campeonato fechado. Pro MK (fora do
computeChampStandings), o gate é `c.id==='mk' ? !!mkKoPodiumOrder((_mkChampData||{}).ko) : ...`
(betKingChamps) e o param `mkClosed` (bettingSeasonRanks, passado pelos predicados
`betKing`/`betVice`/`betMico` que veem `ctx.mk.ko`).

## Passo 6 — HISTÓRICO (todas as fases)
Confere que o histórico de partidas mostra TODAS as fases. No MK o
`MkMatchHistory` ganhou um grupo **MATA-MATA** (lê `_mkChampData.ko` +
`mkKoBracket`) além da liga IDA/VOLTA, e passou a ser renderizado no
`DetailedStatsCard` (não só no MeuPerfil).

## Passo 7 — validar + deploy + verificar
1. Parse OK (CLAUDE.md §4). Sem emoji (skill icons).
2. Bump `?v=` nos 3 pontos + rebuild esbuild (skill build-deploy).
3. **Preview**: abre o perfil/ESTATÍSTICAS do campeão e confirma o troféu + o
   título + o histórico (skill preview-verify).
4. Commit BanePlayss + push com rebase-sobre-o-bot.
5. Avisa o Lucas pra dar Ctrl+Shift+R.

## Passo 8 — VIRADA DE TEMPORADA: zerar os saldos
Quando a season de apostas daquele jogo fecha e vai começar a próxima (ex: MK S1
→ Golf), o Lucas **ZERA todos os saldos de PC** pra começar do zero. Ferramenta:
ADMIN → **MOD** → aba **USUÁRIOS** → card **ZERAR SALDOS (virada de temporada)** →
**ZERAR TUDO** (dupla confirmação). `zeroAllPc` faz SET pc=0 pra todos via
`commitBetDocUpdate`; mantém títulos, troféus, conquistas, cosméticos e CC — só o
PC zera. **BACKUP ANTES** (aba BACKUP, ou captura os saldos por REST — ver
firestore-safety). ISSO NÃO É o mesmo que "as apostas zeram" (essa é o reset
automático do RANKING de aposta por-season). Depois de zerar, todo mundo fica em 0
— pra apostar na season nova precisa de um saldo inicial (dar via **DAR PC PRA
TODOS** se o Lucas quiser um valor pra todos). Supera a nota antiga "nunca resetar
saldo" ([[saldos-legitimos-e-exploit-cashback]]): reset é POR virada de temporada,
decidido pelo dono.

## Cosmético que dá pra deixar pra depois
- Hall da Fama/Vergonha do jogo não-FIFA (usa `buildShowcase`/`ShowcaseItem` que
  assume teamId da FIFA; pra nick precisa da via `copaNick`).
- Label "AO VIVO"→"ENCERRADA" no RANKING DE APOSTAS do jogo (usa
  `computeChampStandings`, que é FIFA-only).
