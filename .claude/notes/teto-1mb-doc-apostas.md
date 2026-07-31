# Teto de 1 MB no doc `primitivao/apostas` — diagnóstico e plano

> Medido em 2026-07-31 lendo o doc ao vivo via REST (read-only, nada foi escrito).
> `updateTime` do doc na medição: `2026-07-31T11:17:26Z`.

---

## 0. Correção da premissa (importante)

O limite de 1 MB do Firestore é **por documento**, não por campo. A conta oficial
inclui nome do doc, nomes de campo e overhead de map/array
([storage-size](https://firebase.google.com/docs/firestore/storage-size)).

O campo `json` tem 884 KB — mas o **documento inteiro tem 977 KB**, porque
`worldcup`, `news`, `interests` e `comments` são siblings e contam.

| campo | bytes (contagem Firestore) | KB | % do doc |
|---|---:|---:|---:|
| `json` | 905 209 | 884.0 | 90.5% |
| `worldcup` | 65 734 | 64.2 | 6.6% |
| `news` | 22 668 | 22.1 | 2.3% |
| `interests` | 5 574 | 5.4 | 0.6% |
| `comments` | 1 148 | 1.1 | 0.1% |
| `discord_webhook` | 138 | 0.1 | — |
| `updatedAt` | 18 | — | — |
| nome do doc + overhead | 99 | — | — |
| **TOTAL** | **1 000 588** | **977.1** | **95.4%** |

**Folga real: 48 020 B (46.9 KB), não os ~140 KB que a leitura só do `json` sugere.**

### A rules não está protegendo esse teto

```
function payloadFits(data) {
  return data.json is string && data.json.size() < 1048576;
}
```

`payloadFits` olha **só o `json`**. Com os siblings ocupando 93 KB, o orçamento
real pro `json` é **953 197 B (930.9 KB)** — a rules deixaria passar um `json` de
1 000 000 B que o Firestore rejeita na hora. Hoje a rules avisa tarde demais:
o erro que chega não é "payload inválido", é falha de escrita bruta.

---

## 1. Composição e taxa de crescimento

### Dentro do `json` (884 KB)

| chave | KB | % | n |
|---|---:|---:|---:|
| `bets` | 822.4 | 93.0% | 1110 cupons |
| `mk` | 38.8 | 4.4% | draw/scores/lineups/ko |
| `users` | 20.1 | 2.3% | 21 |
| `gwyf` | 1.6 | 0.2% | 4 |
| `fixtures` | 0.7 | 0.1% | 4 |
| `teamPlayers` | 0.1 | — | 8 |
| `roundBonus` / `officialDay` | 0.15 | — | — |

### Dentro de `bets` (822 KB, média 759 B/cupom)

`legs` sozinho é **522.1 KB (63.5%)** — 3613 legs, 3.25 por cupom, mas apenas
**203 `fixtureId` distintos**. O resto: `id` 30.1 · `createdAt` 27.1 ·
`combinedOdds` 20.5 · `settledAt` 18.3 · `openMeta` 18.0 · `user` 17.3 ·
`status` 15.8 · `amount` 14.4 · `champId` 13.7 · `officialBonus` 13.4 ·
`payout` 12.7 · `casada` 12.1 · `copyOf` 9.3 · `nick` 9.3 · `combined` 8.7 ·
`phase` 7.8 · `stake` 7.3 · `roundN` 5.9 · `copyOwner` 5.7 · resto < 5 KB.

Por campeonato: `mk` 846 cupons / 690.2 KB · sem `champId` (fifa antigo) 129 /
43.7 KB · `gwyf` 62 / 42.8 KB · `mkko` 24 / 24.5 KB · `fifa` 49 / 20.0 KB.

Por status: **641 lost, 463 won, 6 void, 0 pending**. `mk.locked === true`.
Ou seja: 100% dos cupons já estão liquidados e o MK está fechado.

### Crescimento: não é por mês, é por dia de rodada

| dia | cupons | acréscimo |
|---|---:|---:|
| 2026-06-26 | 212 | **+183.6 KB** |
| 2026-07-01 | 119 | +103.1 KB |
| 2026-07-07 | 93 | +97.2 KB |
| 2026-06-30 | 54 | +53.6 KB |
| 2026-06-25 | 54 | +35.7 KB |
| 2026-07-20 | 44 | +33.8 KB |
| 2026-07-13 | 23 | +24.1 KB |
| 2026-07-27 | 18 | +9.0 KB |

Mês: mai +43.7 KB · jun +435.9 KB · jul +341.7 KB. Último cupom: 2026-07-27.

> **A conclusão que muda a urgência:** um único dia de rodada movimentada
> (183.6 KB) é **~4x a folga inteira**. Não há "faltam X meses" — há
> **"a próxima rodada cheia derruba"**. Um dia de ~50 cupons já estoura.

---

## 2. Onde está o desperdício (verificado contra o dado real, não estimado)

**a) Duplicação legada — 25.3 KB.** 600 cupons MK/mkko carregam ao mesmo tempo
`user`/`amount`/`combinedOdds` **e** `nick`/`stake`/`combined`. Valores idênticos
em **600/600**. Origem: o card do MK manda `stake`/`combined`
([apostas-app.jsx:12931](apostas/apostas-app.jsx:12931), [:12936](apostas/apostas-app.jsx:12936))
e o handler acrescenta os canônicos.

**b) `leg.odd` duplica `leg.odds` — 29.4 KB.** Idênticos em **3080/3080** legs.
⚠️ A liquidação do golf lê `l.odd`, não `l.odds`
([apostas-app.jsx:4587](apostas/apostas-app.jsx:4587)). Remover `odd` sem ajustar
essa linha quebra a re-liquidação do gwyf.

**c) Derivados do `fixtureId` — 82.3 KB.** `phase`/`roundN`/`gi` são exatamente
os três componentes de `mk:VOLTA-13-3`. Confere em **2782/2782** legs.

**d) `home`/`away` das legs mk — 89.3 KB.** Deriváveis de `mk.draw`
(que já guarda `{phase, n, games:[{home, away}]}`) via `fixtureId`.
⚠️ São lidos direto na renderização — [:2458](apostas/apostas-app.jsx:2458),
[:10300](apostas/apostas-app.jsx:10300), [:12543](apostas/apostas-app.jsx:12543),
[:17719](apostas/apostas-app.jsx:17719). Remover exige um **rehidratador no
`normBet`**, não um `delete`.

**e) Acessórios — ~65 KB.** `settledAt` (18.3), `openMeta` em cupom já liquidado
(18.0), flags gravadas explicitamente como `false` (`officialBonus`, `casada`,
`open`).

---

## 3. As três opções, medidas

### Opção A — enxugar o formato

Simulação por estágio (cada linha acumula a anterior):

| estágio | json | doc | % do teto | folga | vs anterior | guard 40% |
|---|---:|---:|---:|---:|---:|---|
| hoje | 884.0 | 977.1 | 95.4% | 46.9 KB | — | — |
| E1 duplicatas exatas (a+b) | 824.6 | 917.7 | 89.6% | 106.3 KB | 93.3% | passa |
| E2 + derivados do fixtureId (c) | 734.1 | 827.3 | 80.8% | 196.7 KB | 89.0% | passa |
| E3 + home/away (d) | 642.9 | 736.0 | 71.9% | 288.0 KB | 87.6% | passa |
| E4 + acessórios (e) | 590.2 | 683.3 | 66.7% | **340.7 KB** | 91.8% | passa |

Ganho total: **33% do json**. Numa escrita só daria 66.8% do anterior — **passa
o `notWipingJson`** (que exige ≥40%). Chaves curtas levariam a 262 KB (−68%),
mas aí o formato deixa de ser legível em backup e no console; não recomendo.

**Impacto backup/restore:** nenhum estrutural — o backup serializa `apostas.bets`
como estiver. Mas restaurar um backup **antigo** (formato gordo) reinfla o doc pra
884 KB. O `restoreFromBackup` precisa enxugar na entrada, senão a Fase 2 se desfaz
sozinha no primeiro restore.

**Impacto UI:** E2/E4 são seguros com `normBet` rederivando. E3 exige o
rehidratador. E1 exige tocar a liquidação do gwyf (item b).

**Veredito:** 340 KB de folga ÷ 183 KB de um dia de pico = **~2 rodadas cheias**.
É alívio real, não solução.

### Opção B — arquivar cupons de temporada encerrada

**O guard mata isso na forma ingênua.** `json` com `bets: []` = 61.5 KB = **7.0%**
do anterior; `notWipingJson` exige ≥ 353.6 KB. Qualquer arquivamento que tire mais
de ~60% dos cupons é **rejeitado pela rules**.

Saídas:
- **B1 — fatiar.** Arquivar em 3+ escritas, cada uma mantendo ≥40% da anterior.
  Não mexe na rules, mas é um processo manual frágil e sem transação.
- **B2 — relaxar temporariamente** (publicar 40%→5%, arquivar, republicar). Janela
  de vulnerabilidade curta e sob controle, mas depende de duas publicações manuais
  no Console sem errar a ordem.
- **B3 — ensinar o guard a distinguir arquivamento de vandalismo** *(recomendado)*:
  ```
  function notWipingJson(newData, oldData) {
    return !(oldData.json is string)
      || newData.json.size() >= (oldData.json.size() * 4 / 10)
      || newData.archiveEpoch > oldData.archiveEpoch;   // arquivamento explícito
  }
  ```
  `archiveEpoch` é um campo top-level que só o fluxo de arquivamento incrementa.
  O caminho normal (`commitBetDocUpdate` não mexe nele) continua protegido igual.

**O que arquivar quebra — e é o ponto mais importante desta opção.** Conquistas e
rankings iteram **todos** os `bets`, sem janela de tempo:

- `ACHIEVEMENTS` ([:10746–10780](apostas/apostas-app.jsx:10746)): `grinder50` (≥50
  cupons), `addict100` (≥100), `whale` (wagered ≥1M), `highRoller`/`brokeBank`/
  `burned100k`, `prophet` (odds ≥20), `parlayKing`/`allIn` (nº de legs),
  `hotHand`/`ironStreak`/`coldFoot`/`cursed` (streaks), `underdog`, `rookie`,
  e `luckyStart` — que precisa do cupom **mais antigo** de todos.
- `betKingChamps` ([:10436](apostas/apostas-app.jsx:10436)) — REI DAS APOSTAS.
- `seasonBettingRanking` ([:10459](apostas/apostas-app.jsx:10459)),
  `betProfileStats` ([:10476](apostas/apostas-app.jsx:10476)).

Arquivar sem compensar = **conquistas somem da noite pro dia** (quem tinha 60
cupons volta a não ter `grinder50`). Isso é pior que o problema original.

**Compensação medida:** um agregado por `(user, champId)` que fica no doc quente —
50 entradas (18 jogadores × campeonatos), **10.8 KB** em objeto ou **4.3 KB** em
array posicional. Guarda `n/w/l/v/wagered/retorno/stakeResolvido/maxAmt/maxWon/
maxLost/maxOddsWon/maxLegs/maxLegsWon/copies/first/bestStreakW/bestStreakL` —
suficiente pra alimentar **todas** as conquistas e rankings acima sem ler o
arquivo. `TicketsView` continua mostrando os cupons quentes; o histórico antigo
vira uma carga sob demanda do doc de arquivo.

Cenários (enxugado + agregado, arquivo em `primitivao/bets_archive_2026`):

| cupons quentes mantidos | json | doc | % do teto | folga |
|---:|---:|---:|---:|---:|
| 150 | 160.4 KB | 253.6 KB | 24.8% | 770.4 KB |
| 250 | 217.9 KB | 311.1 KB | 30.4% | 712.9 KB |
| 400 | 292.8 KB | 385.9 KB | 37.7% | 638.1 KB |

**Impacto backup/restore:** `downloadFullBackup` já faz 4 `.get()` em paralelo —
somar o doc de arquivo é o mesmo padrão de `avatars`/`championships`. Precisa
entrar também no `scripts/backup-firestore.mjs` e no `wipeAllData`, senão o
arquivo sobrevive a um wipe e "ressuscita" cupons.

### Opção C — coleção com um doc por cupom

Resolve o teto de vez (cada cupom ~760 B num doc próprio). Mas colide de frente
com o núcleo que a CLAUDE.md §2.2/§2.3 marca como "NÃO QUEBRAR":

- `commitBetDocUpdate` é **uma transação sobre um doc**. A liquidação varre e
  reescreve todos os cupons a cada tick ([:4575](apostas/apostas-app.jsx:4575)) —
  com coleção isso vira centenas de writes por transação, contra o teto de 500.
- Custo de leitura: hoje o app inteiro é **1 leitura**; viraria 1110 docs.
- O `onSnapshot` único vira dois, e todo o guard de `!snap.exists` da §2.3
  (que já causou o susto de "reset") teria que ser reescrito.
- `notWipingJson` deixa de existir como proteção — vandalismo vira "apagar 1110
  docs", que a rules não barra em bloco.

É a arquitetura certa pra crescer sem teto, mas é **reescrita do núcleo de
persistência** — não é o que se faz com 47 KB de folga e uma rodada chegando.
Proposta pra quando houver Firebase Auth e tempo de fazer com calma.

### Opção D — mover os siblings (não estava na lista, e é a mais barata)

`worldcup` (64.2 KB) e `news` (22.1 KB) **não passam pelo guard do `json`** e não
são tocados pelo `commitBetDocUpdate`. Movê-los pra docs próprios devolve
**86.3 KB** — quase o dobro da folga atual — com mudança pequena e isolada, no
mesmo padrão já usado por `avatars` e `championships`.

| ação | doc | folga |
|---|---:|---:|
| mover `worldcup` | 912.9 KB | 111.1 KB |
| mover `worldcup` + `news` | 890.8 KB | 133.2 KB |

`worldcup.picks` sozinho é o maior sibling e só cresce a cada bolão.

---

## 4. Plano recomendado

**Fase 0 — antes de qualquer escrita** (§2.2 + skill `firestore-safety`)
1. Backup completo: botão ADMIN + `node scripts/backup-firestore.mjs`. Conferir
   que o arquivo tem `json` + todos os top-level + `avatars` + `championships`.
2. Corrigir `payloadFits` pra refletir o teto real — hoje ela deixa passar escrita
   que o Firestore rejeita:
   ```
   function payloadFits(data) {
     return data.json is string && data.json.size() < 716800;  // 700 KB
   }
   ```
   Assim o app falha com erro previsível **antes** do doc estourar.

**Fase 1 — alívio imediato, risco baixo (Opção D).** Mover `worldcup` e `news`
pra docs próprios. **+86.3 KB**, não toca em `bets`, não passa pelo guard.

**Fase 2 — enxugar (Opção A: E1, E2, E4).** **+~113 KB**. Deixar E3 (`home`/`away`)
pra depois, porque exige rehidratador. Obrigatório no mesmo PR: gravar cupom
**novo** já no formato enxuto e enxugar na entrada do `restoreFromBackup` — senão
reinfla sozinho.

> Depois de 1+2: doc em ~66% do teto, **~570 KB de folga**. Isso compra a temporada.

**Fase 3 — arquivamento (Opção B3 + agregado).** É o que resolve de verdade.
Fazer no **encerramento da temporada**, não no meio dela. Ordem: publicar a rules
com `archiveEpoch` → gerar o agregado → escrever o arquivo → só então encolher o
doc quente.

**Opção C** fica fora do escopo agora; revisitar junto com Firebase Auth.

---

## 5. Achado adjacente (fora do escopo, mas relevante pro backup)

[apostas-app.jsx:2304](apostas/apostas-app.jsx:2304) — `restoreFromBackup` grava
com `BET_DOC().set(setPayload)` **sem `{ merge: true }`**, contrariando a regra da
§2.2 / skill (`set` sem merge apaga os siblings). `news` e `discord_webhook` só
entram no payload se existirem no backup:

```js
if (Array.isArray(news)) setPayload.news = news;
if (typeof discord_webhook === 'string') setPayload.discord_webhook = discord_webhook;
writes.push(BET_DOC().set(setPayload));   // <- sem merge
```

Restaurar um backup que não tenha `news`/`discord_webhook` (formato v1, ou gerado
antes desses campos existirem) **apaga os dois no doc ao vivo**. Nenhuma das fases
acima depende disso, mas a Fase 3 aumenta a chance de alguém usar o restore.

---

## 6. Fora de escopo, confirmado

Nada aqui toca saldo de ninguém. `users` são 20.1 KB (2.3% do json) e não fazem
parte do problema; os saldos altos (bane, spider, magreza) são pré-existentes e
legítimos — ver memória `saldos-legitimos-e-exploit-cashback`.
