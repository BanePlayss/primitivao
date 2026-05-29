---
name: build-deploy
description: Build, validate and ship the Primitivão "apostas" app (apostas/apostas-app.jsx → apostas-app.compiled.js → GitHub Pages). Use whenever you edit apostas/apostas-app.jsx, apostas/styles.css or apostas/index.html and need to deploy. Covers JSX validation, the no-emoji check, cache-busting, esbuild, the BanePlayss commit, and the rebase-over-the-build-bot dance.
---

# Build & deploy — apostas (Primitivão)

O projeto fica em `D:/projects/primitivao` (NÃO é o cwd do worktree do Claude).
**Sempre comece o Bash com `cd /d/projects/primitivao`** — o shell volta pro
worktree entre chamadas.

## Fluxo completo (toda mudança em .jsx / .css / .html)

1. **Validar** (idêntico ao CI lint):
   ```
   node -e "require('@babel/parser').parse(require('fs').readFileSync('apostas/apostas-app.jsx','utf8'),{sourceType:'script',plugins:['jsx']});console.log('OK')"
   ```
2. **Checar emojis** (CI bloqueia — ver skill `icons`).
3. **Bump de cache** — mesmo valor `vYYYYMMDD-tag` em 3 pontos:
   - `apostas/index.html`: `styles.css?v=` e `apostas-app.compiled.js?v=`
   - `apostas/apostas-app.jsx`: o `console.log('%c PRIMITIVÃO v=... ')`
   ```
   sed -i 's/TAG-ANTIGA/TAG-NOVA/g' apostas/index.html apostas/apostas-app.jsx
   ```
4. **Build**:
   ```
   npx esbuild apostas/apostas-app.jsx --loader:.jsx=jsx --target=es2018 --minify --outfile=apostas/apostas-app.compiled.js
   ```
5. **Commit** (autor BanePlayss; conventional commit minúsculo; SEM co-author):
   ```
   git add apostas/apostas-app.jsx apostas/apostas-app.compiled.js apostas/index.html apostas/styles.css
   git commit -m "feat(escopo): ..."
   ```
6. **Push com rebase** — o GitHub Action `build.yml` commita um build do bot, então
   o push quase sempre conflita SÓ no `compiled.js`. Resolva rebuildando:
   ```
   git pull --rebase origin main
   # conflito no compiled.js -> rebuild e resolve:
   npx esbuild apostas/apostas-app.jsx --loader:.jsx=jsx --target=es2018 --minify --outfile=apostas/apostas-app.compiled.js
   git add apostas/apostas-app.compiled.js
   GIT_EDITOR=true git rebase --continue
   git push origin main
   ```

## Regras
- **NUNCA** edite `apostas-app.compiled.js` à mão — é gerado e sobrescrito.
- Instalar `firebase --no-save` apaga `@babel/parser`/`esbuild` do node_modules —
  reinstale se sumirem.
- Avisos de CRLF (Windows) são inofensivos.
- No fim, avise o usuário pra dar **Ctrl+Shift+R** (cache do navegador).
- Para VER a mudança antes de commitar, use a skill `preview-verify`.
