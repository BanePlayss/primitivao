---
name: cupom-ux
description: A APARÊNCIA do card de aposta e do cupom do Primitivão — o markup e as classes EXATAS (mk-bet-game, mk-bg-summary, mk-cupom-wrap, mk-betbar, golf-tabs). Use SEMPRE que for montar ou mexer na UI de aposta de qualquer campeonato. Complementa card-de-apostas (que cobre odds/liquidação/anti-exploit); esta aqui é só o visual, e existe porque foi errado 3 vezes seguidas no LoL.
---

# Cupom e card de aposta — a APARÊNCIA (Primitivão)

> A regra é uma só: **não invente classe nova.** O app já tem o sistema pronto;
> copie o markup do MK. Toda vez que se aproximou "de memória" o dono devolveu
> com "está horrível" — e estava mesmo.
> Odds, liquidação e anti-exploit: skill **card-de-apostas**. Aqui é só o visual.

## 0. O erro que essa skill existe pra evitar

No LoL eu fiz, em ordem: (1) classes próprias `.lol-cupom-*` do zero — destoou de
tudo; (2) copiei do **golf** achando que era do MK — `golf-event`/`golf-tabs` no
lugar errado; (3) empilhei todos os mercados dentro de cada card — poluído.
Só na 4ª, abrindo o `renderKoCard` de verdade, ficou certo.

**Antes de escrever qualquer JSX de aposta: abra `MkBettingView` /
`renderKoCard` no `apostas-app.jsx` e copie a estrutura.** Não é opcional.

## 1. Card do confronto — acordeão (`renderKoCard`)

Fechado mostra o resumo com odds; os mercados só aparecem ao expandir.

```jsx
<div className={'mk-bet-game' + (own ? ' own' : '') + (locked ? ' locked' : '') + (open ? ' open' : '')}>
  <div className="mk-bg-summary" role="button" tabIndex={0} aria-expanded={open}
       onClick={toggle}
       onKeyDown={(e) => { if (e.target !== e.currentTarget) return;
                           if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
    <div className="mk-bg-top">
      <span className="mk-bet-rod"><Icon name="..." size={11} /> CONTEXTO · FORMATO</span>
      <span className="mk-bg-caret">{open ? 'FECHAR' : 'VER MERCADOS'} <Icon name={open ? 'caret-up' : 'caret-down'} size={13} /></span>
    </div>

    <div className="mk-bet-match">
      <span className="mk-bm-side">
        <Avatar nick={home} teamPlayers={teamPlayers} size={30} noBadge />
        <span className="mk-bm-info">
          <span className="mk-bm-nick mand">{home}</span>
          <span className="mk-bm-role mand">MANDANTE</span>
        </span>
      </span>
      <span className="mk-bm-vs">×</span>
      <span className="mk-bm-side right">
        <span className="mk-bm-info">
          <span className="mk-bm-nick">{away}</span>
          <span className="mk-bm-role">VISITANTE</span>
        </span>
        <Avatar nick={away} teamPlayers={teamPlayers} size={30} noBadge />
      </span>
    </div>

    {/* barra de chance de DOIS SEGMENTOS + rótulo por lado */}
    <div className="mk-bg-prob">
      <div className="mk-bg-prob-bar">
        <span className="mk-bg-prob-seg h" style={{ width: (p * 100) + '%' }} />
        <span className="mk-bg-prob-seg a" style={{ width: ((1 - p) * 100) + '%' }} />
      </div>
      <div className="mk-bg-prob-lab">
        <span className="mand">{home} {Math.round(p * 100)}%</span>
        <span className="away">{away} {Math.round((1 - p) * 100)}%</span>
      </div>
    </div>

    {/* prévia de odds — dá pra decidir sem abrir o card */}
    <div className="mk-bg-odds">
      <span className="mk-bg-odds-l">QUEM GANHA</span>
      <span className="mk-bg-odd"><b>MAND</b> <i>{oddH.toFixed(2)}</i></span>
      <span className="mk-bg-odd"><b>VIS</b> <i>{oddA.toFixed(2)}</i></span>
    </div>

    <div className="mk-bg-flags">
      {locked && <span className="mk-bg-flag lock"><Icon name="lock" size={10} /> APOSTAS FECHADAS</span>}
      {own && <span className="mk-bg-flag"><Icon name="user" size={10} /> SÓ NA SUA VITÓRIA</span>}
      {isMod && <button className="mk-bg-flag" onClick={(e) => { e.stopPropagation(); ... }}>FECHAR</button>}
    </div>
  </div>

  {open && <div className="mk-bg-body">{/* abas de mercado + opções */}</div>}
</div>
```

Wrapper da lista: `<div className="mk-bet-games">`.
**`e.stopPropagation()` em todo botão dentro do summary** — senão o clique
recolhe o card junto.

## 2. Modo SIMPLES / AVANÇADO — com ícone

Fica FORA do card, no topo da view. Ícones fixos: `target` e `chart`.

```jsx
<div className="mk-bet-mode" role="tablist" aria-label="Modo de aposta">
  <div className="mk-bet-mode-tabs">
    <button role="tab" aria-selected={!av} className={'mk-bet-mode-btn' + (!av ? ' on' : '')} onClick={() => setAv(false)}>
      <Icon name="target" size={11} /> SIMPLES
    </button>
    <button role="tab" aria-selected={av} className={'mk-bet-mode-btn' + (av ? ' on' : '')} onClick={() => setAv(true)}>
      <Icon name="chart" size={11} /> AVANÇADO
    </button>
  </div>
  <span className="mk-bet-mode-hint">…o que o modo faz, em uma frase…</span>
</div>
```

## 3. Abas de MERCADO — uma por mercado, um por vez

**Não empilhe os mercados.** Uma fila de abas + a descrição do mercado ativo;
o corpo mostra só o mercado selecionado.

```jsx
<div className="golf-tabs" role="tablist" aria-label="Mercados">
  {mercados.map(m => {
    const n = cupom.filter(l => l.market === m.k && l.fixtureId === fid).length;
    return (
      <button key={m.k} role="tab" aria-selected={cur === m.k}
              className={'golf-tab' + (cur === m.k ? ' on' : '')} onClick={() => setMkt(m.k)}>
        <Icon name={m.icon} size={13} /> <span>{TAB_CURTO[m.k]}</span>
        {n > 0 && <span className="golf-tab-c">{n}</span>}
      </button>
    );
  })}
</div>
<div className="golf-tab-desc"><strong>{mkt.label}</strong> · {SUB[mkt.k]}</div>
```

Voltar pro SIMPLES com uma aba do AVANÇADO aberta cai num mercado que sumiu →
**sempre** `mercados.find(m => m.k === mkt) || mercados[0]`.

## 4. Opção de mercado — avatar + barra de prob + chance% + odd

```jsx
<button className={'lol-opt' + (sel ? ' sel' : '') + (off ? ' off' : '')} disabled={off}
        style={{ ['--pk-fill']: Math.max(2, Math.round(prob * 100)) + '%' }}
        title={nome + ' — ' + Math.round(prob * 100) + '% de chance'}>
  <span className="lol-opt-l">
    {ehJogador ? <Avatar nick={nome} teamPlayers={tp} size={20} noBadge />
               : <span className="lol-opt-x"><Icon name="x" size={13} /></span>}
    <span className="lol-opt-n">{nome}</span>
    {fav && <span className="lol-opt-tag fav">FAV</span>}
    {zebra && <span className="lol-opt-tag zebra">ZEBRA</span>}
  </span>
  <span className="lol-opt-r">
    <span className="lol-opt-p">{prob >= 0.005 ? Math.round(prob * 100) + '%' : '<1%'}</span>
    <span className="lol-opt-o mono">{odd.toFixed(2)}</span>
  </span>
</button>
```

O `--pk-fill` vira a largura de um `::before` — a barra de probabilidade DENTRO
do botão. **FAV/ZEBRA só quando o extremo é ÚNICO** (`odds.filter(o => o === menor).length === 1`):
num mercado parelho os dois lados empatam na maior odd e marcar "ZEBRA" nos dois
não informa nada.

Opção que NÃO é jogador (EMPATE, uma forma de vitória, Sim/Não) usa o
`.lol-opt-x` no lugar do avatar — não invente placeholder.

## 5. Gaveta do cupom — `.mk-cupom-wrap` + o sistema de cards do app

Nada de classe própria: `.card cupom`, `.card-head`, `.card-body`, `.cupom-leg`,
`.modal-row`, `.stake-input`, `.quick`, `.payout-box`, `.modal-btns`.

```jsx
<aside className={'mk-cupom-wrap' + (open ? ' cupom-open' : '')}
       style={open ? { transform: 'translateY(0)' } : undefined}>
  <button className="cupom-sheet-handle" onClick={close}>
    <span className="cupom-sheet-grip" aria-hidden="true" />
    <span className="cupom-sheet-handle-label">FECHAR CUPOM</span><Icon name="caret-down" size={14} />
  </button>
  <div className="card cupom">
    <div className="card-head">
      <div className="title">CUPOM {casada ? '· CASADA' : ''}</div>
      <div className="sub">{n} {n === 1 ? 'PALPITE' : 'PALPITES'}</div>
    </div>
    <div className="card-body">
      {vazio ? <div className="empty"><div className="e1">VAZIO</div><div className="e2">…</div></div> : <>
        {/* uma .cupom-leg por perna: selo do mercado + confronto + pick + odd + X */}
        <div className="cupom-leg">
          <div className="cupom-leg-txt">
            <div className="cupom-leg-mkt">
              <span className="cupom-leg-ko" style={{ background: 'var(--pv-orange)' }}>{CURTO[l.market]}</span>
              {' '}{l.home} x {l.away}
            </div>
            <div className="cupom-leg-pick"><strong>{label}</strong></div>
          </div>
          <div className="cupom-leg-odd mono">{l.odd.toFixed(2)}</div>
          <button className="cupom-leg-x" onClick={remover}><Icon name="x" size={12} /></button>
        </div>

        <div className="modal-row" style={{ marginTop: 10 }}>
          <span className="lab">ODDS TOTAL</span>
          <span className="mono" style={{ color: 'var(--pv-orange)', fontWeight: 800 }}>{combinada.toFixed(2)}x</span>
        </div>
        <div className="modal-row"><span className="lab">SALDO</span><span className="mono">{compactPC(bal)} PC</span></div>

        <div className="small-label" style={{ marginTop: 10 }}>QUANTO APOSTAR (PC)</div>
        <input type="number" min="1" className="stake-input" value={stake} onChange={…} />
        <div className="quick">
          <button onClick={() => setStake(Math.min(50, bal))}>50</button>
          <button onClick={() => setStake(Math.min(100, bal))}>100</button>
          <button onClick={() => setStake(Math.min(500, bal))}>500</button>
          <button onClick={() => setStake(bal)}>MAX</button>
        </div>

        <div className="payout-box">
          <div className="nm">RETORNO POTENCIAL</div>
          <div className="v">{compactPC(retorno)} <span style={{ fontSize: 12, letterSpacing: '0.3em', fontFamily: 'Space Grotesk' }}>PC</span></div>
          <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: 'var(--pv-orange)', marginTop: 4 }}>
            LUCRO: +{compactPC(retorno - valor)} PC
          </div>
        </div>

        {/* erro OU aviso de casada, com <Icon name="warning" size={12} /> */}
        <div className="modal-btns">
          <button className="btn-secondary" onClick={limpar}>LIMPAR</button>
          <button className="btn-primary" disabled={…} onClick={apostar}>
            {semSaldo ? 'SEM SALDO' : busy ? '...' : 'APOSTAR ' + valor + ' PC'}
          </button>
        </div>
        <div className="cupom-public-note"><Icon name="cards" size={12} /> Toda aposta é pública na MESA DOS CARTOLAS.</div>
      </>}
    </div>
  </div>
</aside>

{open && <button className="cupom-sheet-backdrop" type="button" aria-label="Fechar cupom" onClick={close} />}
```

## 6. Barra do cupom (`.mk-betbar`)

Só quando **há palpite E a gaveta está fechada**. Sem ela a gaveta fica escondida
em `translateY(105%)` e não dá pra apostar — foi um bug real do golf.

```jsx
{n > 0 && !open && (
  <button className="mk-betbar" onClick={() => setOpen(true)}>
    <span className="mk-betbar-main">
      <span className="mk-betbar-badge"><Icon name="ticket" size={16} /> {n}</span>
      <span className="mk-betbar-info">
        <span className="mk-betbar-title">{n === 1 ? '1 PALPITE' : n + ' PALPITES'}{casada ? ' · CASADA' : ''}</span>
        <span className="mk-betbar-sub">retorno ~{compactPC(retorno)} PC</span>
      </span>
    </span>
    <span className="mk-betbar-cta">
      <span className="mk-betbar-odd">{combinada.toFixed(2)}x</span>
      <span className="mk-betbar-go">VER CUPOM <Icon name="caret-up" size={14} /></span>
    </span>
  </button>
)}
```

## 7. TEMA ESCURO — a pegadinha

A regra "texto sempre charcoal" vale pro conteúdo **dentro de `.card`/`.ticket`**
(que são claros nos dois temas). Elemento que fica **solto no fundo da página**
(trilho de rodadas, bloco de modo, dica) tem fundo ESCURO no tema escuro — usar
charcoal ali faz sumir. Já aconteceu duas vezes.

Padrão claro + inversão no tema claro:
```css
.x       { background: rgba(244,234,215,0.10); border-color: rgba(244,234,215,0.30); color: var(--pv-bone); }
.x.on    { background: var(--pv-bone); color: var(--pv-charcoal); }
html:not(.pv-dark) .x    { background: rgba(28,22,18,0.06); border-color: rgba(28,22,18,0.25); color: var(--pv-charcoal); }
html:not(.pv-dark) .x.on { background: var(--pv-charcoal); color: var(--pv-bone); }
```
Confere no preview com `getComputedStyle` — o fundo da página escura é
`rgb(22,16,11)`. Ver [[tema-escuro-cards-sempre-claros]].

## 8. Ícones — nunca emoji

`<Icon name="..." />` (CLAUDE.md §1; o CI barra emoji). Usados aqui:
`target` SIMPLES · `chart` AVANÇADO · `ticket` cupom · `lock`/`unlock` trava ·
`caret-up`/`caret-down` acordeão · `x` remover e opção-não-jogador ·
`warning` aviso · `cards` nota da Mesa · `user` seu confronto.
**Não use `coin`** num rótulo de mercado: aquele ícone tem "PC" desenhado dentro
(é o da moeda) e sai escrito PC no meio do texto.

## 9. Checklist antes de dizer que ficou pronto

1. Abriu o `renderKoCard`/`MkBettingView` e copiou? (não "lembrou")
2. Card é acordeão, com prévia de odds no resumo?
3. Um mercado por vez (abas), não empilhado?
4. Opção com avatar + barra `--pk-fill` + chance% + odd? FAV/ZEBRA só se único?
5. Gaveta usando `.card cupom` + `.quick` + `.payout-box` + `.modal-btns`?
6. `.mk-betbar` aparecendo só com palpite e gaveta fechada?
7. Legível nos DOIS temas (checou `getComputedStyle`)?
8. **Varreu TODAS as abas nos DOIS modos no preview.** Teste puro não pega
   ligação-UI: no LoL um `pr.OBJ` órfão derrubou a aba inteira e a suíte de 3123
   asserts continuou verde, porque eu só tinha olhado o mercado que abre por
   padrão.

## 10. PENDENTE — a VIEW DE CAMPEONATO também tem que copiar o MK

Esta skill cobre o card de APOSTA. A **view de campeonato** (aba CAMPEONATOS)
tem a mesma dívida: a do LoL (`LolView`) está crua perto da do MK
(`MkChampionshipView`), e o dono pediu que fique igual. Copiar de lá, não
aproximar de memória.

O que o MK tem e o LoL não:

**Classificação (coluna esquerda)**
- Cabeçalho com ícone + subtítulo de contexto ("13 INSCRITOS · TOP 8 VAI PRO
  MATA-MATA")
- Faixa "Classificação oficial — atualiza sozinha conforme os placares saem"
- Barra colorida na lateral de cada linha marcando a ZONA (pódio / classificado
  / eliminado) — no LoL seria top-2 (bye pra semi) / 3º-8º / fora
- **Sub-linha por jogador** (no MK são os 3 personagens). No LoL cabe o
  aproveitamento ou as formas de vitória mais usadas.

**Rodadas (coluna direita)**
- Header "RODADA N" + navegação com setas
- Pílulas numeradas agrupadas por fase, com cor por estado
  (encerrada · atual · a vir) e legenda embaixo
- Contador "N jogos · N lançados"

**Cards de jogo**
- Destaque **SEU JOGO** com borda
- MANDANTE / VISITANTE com selo
- Placar por partida (no LoL: 2-0 / 1-1 / 0-2 + a FORMA de cada vitória)
- Selo de resultado especial (W.O. no MK)

O `LolView` hoje já tem os dados (`computeLolStandings`, `lolRoundRobin`,
`lolMatchOutcome`, `lolKoBracket`) — falta só a apresentação.
