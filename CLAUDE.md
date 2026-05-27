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
arrow-right, arrow-up-right, arrow-down, refresh, caret-up, caret-down,
x, warning, lock, unlock, flag, question, medal, gift, menu, skull, fire,
book, newspaper, dice, user, gamepad, phone, chart, pin, square-filled,
chat, ticket, flask, tag, trash, toilet, toothbrush`

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
