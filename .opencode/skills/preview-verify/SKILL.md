---
name: preview-verify
description: Visually verify a change to the Primitivão app by rendering it in a local browser before shipping, instead of editing blind. Use when a change is visual (tabloid, layout, colors, icons, new component) and you want to confirm it actually renders right. Encodes the working preview loop and its gotchas in this environment.
---

# Verificar no preview (parar de editar no escuro)

## Setup
1. `.claude/launch.json` (na raiz do worktree do Claude, não do projeto) com um
   server estático servindo o app:
   ```json
   { "version": "0.0.1", "configurations": [
     { "name": "apostas", "runtimeExecutable": "python",
       "runtimeArgs": ["-m","http.server","8099","--directory","D:/projects/primitivao/apostas"],
       "port": 8099 } ] }
   ```
2. `preview_start` name `apostas` → guarde o `serverId`.
3. Serve o `index.html` (carrega o `compiled.js`) → **rebuild ANTES** de testar
   mudança no `.jsx` (senão vê código velho).

## Login + navegação
- Login admin: nick **`admin`**, senha **`primitivaoseguro`**.
  `preview_fill input[placeholder="seu apelido"]=admin`, `input[type=password]=...`,
  `preview_click button[type="submit"]`.
- Sessão persiste em localStorage (reload mantém logado).
- Clicar por texto (a nav não tem selic fácil) via `preview_eval`:
  ```
  Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='ADMIN').click()
  ```
  Depois `'JORNALISTA'` etc. Espere o re-render com async eval + poll (setTimeout).

## GOTCHAS deste ambiente (importantes)
- **`preview_screenshot` SEMPRE dá timeout** aqui — não dá pra "ver" imagem.
  Use **`preview_inspect`** (estilos/bbox computados — confiável) e
  **`preview_eval` SÍNCRONO** pra ler estado/medidas.
- **`html-to-image` (export PNG) TRAVA** aqui também — não dá pra capturar o pôster.
- Medir layout REAL do tabloide (sem o scale da prévia): setar
  `document.querySelector('.tp-scaler').style.transform='none'`, depois comparar
  `getBoundingClientRect()` dos filhos contra o `.tp` (detecta overflow/overlap).
- Ler cor por-campeonato: `getComputedStyle(tp).getPropertyValue('--tp-accent')`.
- **Cache**: o browser cacheia `compiled.js`/`styles.css` pelo `?v=`. Pra ver a
  mudança: bumpe o `?v=` (sed) + rebuild, e navegue pra `'/index.html?cb='+Date.now()`.
- Firestore mantém conexão aberta (a página nunca fica "network idle").
- Trocar tipo/campeonato no tabloide é state LOCAL — não escreve no Firestore.

## O que dá pra afirmar com inspect/eval (sem screenshot)
Existência/contagem de elementos, classes, cores computadas, font-size, bounding
boxes (posição/tamanho → overflow, overlap, alinhamento), texto renderizado das
histórias de zoeira. Suficiente pra pegar a maioria dos problemas de layout.
