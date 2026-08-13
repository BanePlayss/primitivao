---
name: tabloid
description: Work on the Jornalista tabloid generator in the Primitivão app (ADMIN → JORNALISTA → MODELO TABLOIDE) — the vintage newspaper-style poster builder. Use to add or tweak championship themes, the 3 tabloid types (rodada/eventos/polemica), the zoeira triggers, the per-championship visual identity, the hero-image slot, VOL auto-increment, or the PNG export.
---

# Tabloide "PRIMITIVÃO TIMES" (Jornalista)

Pôster sépia (largura fixa 1040px) montado em React no app e exportado em PNG.
Tudo em `apostas/apostas-app.jsx`. Componentes: `TabloidPoster` (render) e
`TabloidBuilderPanel` (form + prévia + export). Vive no painel ADMIN → JORNALISTA.

## Estrutura
- **Pickers**: campeonato (`TABLOID_CHAMP_OPTS` = `CHAMPIONSHIPS` + a Copa) + tipo.
- **3 tipos** (`data.type`):
  - `rodada` — recap: campeão + 2 blocos (vice/lanterna) + faixa do meio + confrontos.
  - `eventos` — anúncio central: arte (imagem) + caixas PRÊMIO/REGRAS/QUEM TÁ DENTRO + confrontos.
  - `polemica` — grid de cards de zoeira.
- **Identidade por campeonato** — `TABLOID_THEMES[champId]` = `{ wordmark, accent
  (CJK decorativo), stamp, icon, color }`:
  - `color` → vira CSS var `--tp-accent` no root do pôster (inline style) e pinta
    wordmark, selo, odds, kickers, a **faixa colorida do topo** (`.tp-topband`) e a
    **marca d'água** gigante (`.tp-watermark`).
  - `icon` → aparece no masthead, na manchete (no lugar da chama), na marca d'água e
    nos títulos de seção. Cada campeonato deve ter cor + ícone DISTINTOS.

## Dados — `buildTabloidData(ctx, champId, type)`
`ctx = { cs, bets, users, teamPlayers, worldcup, wcFixtures }`. Os 3 níveis de props:
App → AdminView → JournalistAdminPanel → TabloidBuilderPanel.
- FIFA/demais: usa `computeChampStandings(champId, cs)` + `currentRoundMatchups(cs)`.
- **Copa** tem branch próprio: `computeCopaStandings(worldcup, wcFixtures)`; avatares
  por **nick** (jogador pode não ter time da FIFA → cai pro círculo com inicial).

## Zoeira (triggers) — FOCO NOS JOGOS, nunca PC/apostas
`tabloidStories({ standings, cs, teamPlayers })` → histórias
`{ teamId, nick, kicker, text, icon, tone }` (tone: good/bad/spice).
`pickStories(all, 6)` sorteia (Fisher-Yates, Math.random é permitido no app).
Triggers: invicto, zerado, combo, disputa (ponta), lanterna, goleador, peneira,
saldo, **goleada** (maior placar real de `cs.rounds`), **proximo** (confronto da
semana via `bettableGames`). Copa: `copaStories(ranking, teamPlayers)`.
Adicionar trigger = mais um `push(id, teamId, nick, kicker, text, icon, tone)`.
**Só dispara onde há dado** (hoje FIFA + Copa); os "em breve" usam o tipo `eventos`.

## Outras peças
- **Imagem de destaque** (arte da IA): upload → data URL → embute no PNG. É a única
  forma de ter ilustração de personagem (CSS não desenha isso).
- **VOL** auto-incrementa (localStorage `primitivao_tabloid_vol`): abrir = último+1;
  exportar = grava aquele número.
- **Export** PNG via `window.htmlToImage.toPng` com **watchdog de 20s** (a lib pode
  travar em alguns ambientes — não deixar o botão preso).
- Para conferir o visual antes de shipar, use a skill `preview-verify`
  (screenshots travam neste ambiente — use inspect/eval).
