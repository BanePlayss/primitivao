# CLAUDE.md — Regras permanentes do Primitivão

> Fonte de verdade pra qualquer agente (Claude/Cursor/etc) tocando este repo.
> Ler antes de propor mudanças.

## 1. SEM EMOJIS NA UI

**Regra absoluta:** nada de emojis Unicode (🏆 🎯 ⚠ ✓ etc) em código, copy,
botões, títulos ou qualquer elemento visível ao usuário.

Toda decoração visual usa o componente `<Icon name="..." />` definido em
`apostas/apostas-app.jsx`. Os ícones são SVG inline, lineart, viewBox 24x24,
herdam cor via `currentColor`.

**Ícones disponíveis** (lista viva — adicionar novos quando precisar):
`star, shield, sparkle, check, eye, eye-off, target, trophy, globe, coin,
coin-stack, coin-fire, arrow-right, arrow-up-right, arrow-down, refresh,
caret-up, caret-down, x, warning, lock, unlock, flag, question, medal,
gift, menu, skull, fire, book, newspaper, dice, user, gamepad, phone,
chart, pin, square-filled, chat, ticket, flask, tag, trash, toilet,
toothbrush, crown, bolt, heart, football, sword, whistle, snowflake,
rocket, crosshair, fist, chess, pokeball, cards`

> A galeria completa renderizada fica em **ADMIN → CATÁLOGO** (todos os
> ícones, títulos, distintivos e molduras num lugar só, pra QA).

**Como adicionar um novo ícone:**
1. Abre o `switch (name)` dentro de `function Icon(...)` no `apostas-app.jsx`.
2. Adiciona um novo `case` retornando um `<svg {...common}>...</svg>`.
3. Usa `stroke="currentColor"` e `fill="none"` (ou `fill="currentColor"` pra
   ícones sólidos). Desenha em viewBox 24x24.
4. Documenta o nome aqui em cima.

**Exceções permitidas** (caso a caso, documentar antes):
- Bandeiras nacionais em conteúdo (🇧🇷, 🇫🇷 etc na Copa do Mundo) — são
  **conteúdo informacional**, não decoração.
- Setas em comentários de código (`// foo → bar`) — não renderizam.

**Nunca:** introduzir emoji novo em copy/botão/título/header/badge.
Sempre: criar um `case` novo no `Icon` ou reusar um existente.

## 2. Stack & arquitetura

- React 18 — tudo em `apostas/apostas-app.jsx` (fonte).
- Em **produção** (`apostas/index.html`): carrega `apostas-app.compiled.js`
  (minificado, sem Babel runtime). É gerado pelo GitHub Action `build.yml`.
- Em **dev** (`apostas/dev.html`): carrega `apostas-app.jsx` direto com
  Babel standalone. Mais lento, mas iteração instantânea.
- Firebase Firestore compat (`window.db`) com **transações** pra escrita.
- Top-level fields: `interests`, `comments`, `teamPlayers`, `worldcup`,
  `news`, `discord_webhook`.
- Tudo via `commitBetDocUpdate(reducer)` com safety net + sentinel
  `{ __abort: true, result }` pra erros sem escrever.

## 2.0.1 Navegação no arquivo único

`apostas-app.jsx` é grande (~5500 linhas) por design — mantém deploy
trivial (cat para GH Pages). Pra navegar:

1. **Tabela de conteúdo** está no topo do arquivo (linhas 1-70).
   Lista as 8 grandes seções com offsets.
2. **Banners de seção** padronizados:
   `// ─── NOME DA SEÇÃO ─────────────────────────────────────────`
   Use Ctrl+F com `// ─── ` pra pular entre eles.
3. **Componentes JSX** são funções nomeadas. `grep -n "^function "`
   lista todos rapidinho.

Não fazer split em ES modules sem antes resolver: ordem de carregamento
no `dev.html` (Babel standalone não tem `import/export`), build pipeline
pro `compiled.js` continuar funcionando, e simplicidade pra editar.

## 2.1 Workflow de desenvolvimento

```
# editar
vim apostas/apostas-app.jsx

# rodar localmente (dev mode, sem build)
open apostas/dev.html

# validar (idêntico ao CI)
node -e "require('@babel/parser').parse(require('fs').readFileSync('apostas/apostas-app.jsx','utf8'), {sourceType:'script', plugins:['jsx']}); console.log('OK')"

# (opcional) gerar build local pra testar produção
npx esbuild apostas/apostas-app.jsx --loader:.jsx=jsx --target=es2018 --minify --outfile=apostas/apostas-app.compiled.js

# commit + push — Action `build.yml` recompila e comita o .compiled.js
git add apostas/apostas-app.jsx
git commit -m "..."
git push
```

**NUNCA** edite `apostas-app.compiled.js` direto. Ele é gerado e qualquer
mudança vai ser sobrescrita pela próxima build.

## 2.2 Mutações no Firestore (NÃO QUEBRAR)

Toda escrita no doc `primitivao/apostas` passa por
`commitBetDocUpdate(reducer)` — transação que lê o estado, roda o
reducer, normaliza e grava. O reducer pode retornar:

- `null` / `undefined` → no-op
- `{ __abort: true, result }` → no-op, devolve `result` pro caller
- **estado direto** (`{ ...remote, bets: [...] }`) → grava
- **`{ next: <estado> }`** → grava `<estado>` (usado pelo write-back)

O helper **desempacota `out.next`** antes de gravar. Se você mexer no
`commitBetDocUpdate`, NUNCA grave `out` direto sem checar `out.next` —
senão o campo `next` vira lixo dentro do `json` e o estado real é
perdido (esse bug já aconteceu 2x). O `safe` final faz
`delete safe.next` defensivo.

Campos **top-level** (siblings do `json` stringificado), NÃO entram no
reducer/json: `interests`, `comments`, `worldcup`, `news`,
`discord_webhook`. São lidos/escritos direto via `BET_DOC().set(..., {merge:true})`.

Backup completo (botão admin + GitHub Action) tem que cobrir json +
TODOS os top-level. Ver `downloadFullBackup` e `scripts/backup-firestore.mjs`.

## 2.3 `onSnapshot` + `!snap.exists` (NÃO QUEBRAR — já causou "reset")

Os dois listeners `onSnapshot` (doc `apostas` e doc `state`) tratam
`!snap.exists`. **Um snapshot pode chegar com `exists=false` de forma
TRANSIENTE** — cache vazio na 1ª conexão, reconexão offline→online,
avaliação de regras. Tratar isso ingenuamente como "seed/reset" já fez o
app **parecer resetado** (renderiza estado inicial vazio) e quase apagou
o doc real.

Regras obrigatórias no branch `!snap.exists`:
1. Se já carregamos dados reais (`hasLoadedRef`/`csLoadedRef`), **ignora**
   o evento — é transiente; o snapshot do servidor vem logo.
2. Se `snap.metadata.fromCache` é `true`, **não cria nada** — espera o
   servidor (segura a tela "CONECTANDO").
3. Só cria o doc quando o **servidor** confirma que não existe, e SEMPRE
   com `{ merge: true }` (nunca apagar `news`/`discord_webhook`/etc).

Nunca chamar `setSynced(true)`/`setCs(...)` com estado vazio fora desses
guards — senão a UI mostra "tudo zerado" e o `isNewNick` passa a pedir
"criar conta" pra usuário que já existe.

## 3. Cache busting

Toda mudança que afeta o JSX precisa:
1. Bumpar `?v=YYYYMMDD-tag` em `<script src="apostas-app.compiled.js?v=...">`
   no `index.html`.
2. Atualizar o `console.log('%c PRIMITIVÃO v=... ', ...)` no topo do
   `apostas-app.jsx`.
3. Avisar o usuário pra dar hard refresh (Ctrl+Shift+R).

## 4. Validação antes de commit

```bash
cd /d/projects/primitivao
node -e "require('@babel/parser').parse(require('fs').readFileSync('apostas/apostas-app.jsx','utf8'), {sourceType:'script', plugins:['jsx']}); console.log('OK')"
```

Sempre rodar antes de commitar mudanças no JSX. Se der erro de parse,
arrumar antes — não pushar JSX quebrado.

## 5. Idioma

PT-BR em todo texto visível ao usuário. Variáveis e nomes de função em
inglês. Comentários podem ser PT-BR (preferência do dono).

## 6. Estilo visual

- Paleta laranja `--pv-orange #d76414` + charcoal `--pv-charcoal #1c1612` +
  bone `--pv-bone #f4ead7`. Verde `--pv-green` e vermelho `--pv-red` pra
  estado.
- Fontes: `Bagel Fat One`/`Bungee Inline` pra display, `Space Grotesk` pra
  body, `JetBrains Mono` pra números/códigos.
- Estética "manchete de jornal antigo": letterspacing alto em headers,
  tracking 0.18–0.32em em labels.

---

_Última revisão: 2026-05-27 — adicionada regra SEM EMOJIS._
