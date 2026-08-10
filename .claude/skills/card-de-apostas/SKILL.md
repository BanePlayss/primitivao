---
name: card-de-apostas
description: Como construir um CARD DE APOSTAS no Primitivão (a UI de aposta que teve no MK/FIFA) — mercado, odds, cupom/slip, placeBet e liquidação. Use SEMPRE que for criar/ajustar apostas de um campeonato (golf, RL, LoL...). Padrão reutilizável + guardas anti-exploit já provadas no MK.
---

# Card de apostas — padrão reutilizável (Primitivão)

> A aposta vive na aba **APOSTAS/JOGOS** (não em CAMPEONATOS — lá é só
> classificação/rodadas). Cada campeonato apostável roteia pro seu próprio card.
> Fonte provada: MK (`MkBettingView`, `renderKoCard`, `placeKoBet`) e FIFA
> (`ApostarView`). Deploy: skill build-deploy. Dinheiro: revisar SEMPRE.

## 1. Anatomia de um card de aposta
Um card = um FIXTURE (confronto, mapa, evento) com um ou mais MERCADOS. Cada
mercado lista OPÇÕES (jogador / sim-não / placar) com ODD. O usuário toca numa
opção → vira uma PERNA (leg) no CUPOM → confirma valor → `placeBet`.

Roteamento na aba APOSTAS (App render): `apostasChampId === 'mk' ? <MkBettingView>
: apostasChampId === 'gwyf' ? <cards do golf> : <ApostarView>` (FIFA genérico).
Cada campeonato tem seu branch — NÃO enfia tudo no ApostarView.

## 2. Modelo de dados (não inventar outro)
- **Leg**: `{ fixtureId, champId, market, pick, odd, ... }`. `fixtureId` com
  prefixo por tipo (`mk:`, `mkko:`, `mkkot:`, `gwyf:`...) pra `legSummary`/liquidação
  distinguirem. `champId` identifica a season (ranking de aposta é por champId).
- **Ticket** (via `commitBetDocUpdate` → `bets[]`): `{ user, legs, amount,
  combinedOdds, payout, status:'pending'|'won'|'lost', createdAt, open:true,
  openMeta, copyOf?, cashbackDeferred? }`. Nasce `open:true` (aparece + copiável na
  Mesa dos Cartolas — ver `mesaChampFamily`).

## 3. Odds
Odd sai de uma PROBABILIDADE via uma fórmula única. MK: `mkKoOddFromProb(p) =
max(PISO, 1+(1/p−1)·K)`. A prob vem de uma simulação/model puro (testável em
node). Sem histórico (ex: golf no começo) → odds **parelhas/manuais** (o dono
decidiu) e ajustam conforme os resultados saem. Formata número grande com
`mkOddText`/`compactPC`.

## 4. Cupom (slip) + placeBet
- `toggle<X>Leg(leg)` adiciona/remove do `cupom` (state local). Mercados
  correlacionados/excludentes → **SINGLES-ONLY** (`setCupom([leg])`, e os outros
  toggles filtram `!l.tourney`) pra não casar +EV.
- `placeBet`/`place<X>Bet(payload)`: valida saldo, **RECOMPUTA odd/prob do estado
  REMOTO** (ignora o que o cliente mandou — anti-tamper), rejeita mercado
  fechado/começado, grava o ticket. Retorna erro amigável (toast).

## 5. Liquidação (settle)
Um `useEffect` keyado no dado de resultado (ex: `[mkKo]`, `[golfScores]`) varre
`bets`, filtra `champId`, e pra cada pending calcula win/lose pelo RESULTADO REAL
(nunca pelo odd do cliente). Paga `payout` (+bônus DIA OFICIAL), credita/debita
`users[].pc` DENTRO da mesma transação. Copiadas da Mesa: portar a economia
(seguro/cashback diferido, `FOLLOW_FEE`, gorjeta, reputação) — ver a liquidação do
KO. Idempotente: só mexe em `status==='pending'`.

## 6. Travas (mod) + anti-exploit (obrigatório revisar)
- **Fechar aposta**: cronômetro (`lockAt`, 30s) + `locked` duro + começou
  (`mkGameClosed`/started). Card mostra "FECHA EM Xs". Cancelamento de cupom
  travado quando o evento começou (anti hedge-and-cancel).
- **Recompute no servidor** (odd/prob do remoto). **Singles-only** pra mercados
  encaixados/excludentes (senão o produto das odds paga +EV — aconteceu no MK, ver
  [[mk-mata-mata]]). **Sem apostar em quem entrega o jogo** (confronto: não aposta
  no próprio; outright: pode).
- **Rodar revisão adversarial de dinheiro** (simular estados, procurar +EV/EV≥1)
  antes de deployar QUALQUER card novo. No MK rodaram 3+ revisões.

## 7. Card UI (estilo MK)
> **A APARÊNCIA tem skill própria: `cupom-ux`.** Markup e classes exatas do
> card (acordeão), das abas SIMPLES/AVANÇADO, da gaveta e da barra. Ler ANTES
> de escrever JSX de aposta — aproximar "de memória" já foi refeito 3x.

Reusa a estética do MK: card com header (fixture), corpo com mercado(s) em
linhas/acordeão, cada opção = botão com foto/nome + chance% + odd; azarão marcado
(maior prêmio) e favorito. Estados: aberto / travado (FECHA EM Xs) / fechado /
liquidado. Mod vê lançar-resultado inline no card (paridade). CSS: reaproveita
`.mk-*`/`.std-*`; texto charcoal em card claro (regra tema-escuro).

## 8. Checklist de um card novo
1. Definir MERCADO(S) + como a odd sai (prob pura testável OU manual/parelha).
2. Leg (fixtureId com prefixo + champId) + `legSummary` renderiza a perna.
3. Card UI (branch no roteamento APOSTAS + componente estilo MK).
4. Cupom (toggle + singles-only se correlato) + `place<X>Bet` (recompute server).
5. Liquidação (effect no dado de resultado, paga payout, copy-economics).
6. Travas (lockAt/locked/started) + cancel-lock.
7. **Revisão adversarial de dinheiro** + testes puros em node.
8. Mesa dos Cartolas: `mesaChampFamily`/`mesaMinOddsFor` pro champId novo.
9. Validar/emoji/bump/build/deploy (build-deploy) + preview-verify.
