# Firebase local (emulador) — como usar

Montado em 2026-08-17, no dia em que a **cota do Firestore estourou** e o site
(e o PRIMICORD) ficaram fora até a virada. O emulador não tem cota nenhuma.

## Requisitos (já instalados nesta máquina)

- JDK 21 (Temurin) — o emulador do Firestore roda em JVM
- `firebase-tools` global (`npm i -g firebase-tools`)

## Rodar

```bash
npm run emu          # sobe o Firestore em 127.0.0.1:8080 + UI em :4000
npm run emu:seed     # semeia com o backup mais recente de backups/
npm run emu:seed backups/2026-08-10-pre-virada-lol.json   # ou um específico
npm run emu:rules    # prova que a firestore.rules está ativa e correta
```

Depois abre **`apostas/dev-emu.html`** (não o `dev.html`). Ele chama
`useEmulator('127.0.0.1', 8080)` e imprime um aviso azul no console. O
`index.html` de produção **não foi tocado** — não tem como confundir.

## O que isso destrava

- Desenvolver sem gastar cota e sem risco de estragar dado real.
- **Testar as ESCRITAS**, não só as funções puras. Foi por esse buraco que
  passaram o `l.odd` do golf (liquidação lia campo compactado) e o `pr.OBJ`
  (mercado renomeado) — teste puro ficou verde com o app quebrado.
- **Testar a rules ANTES de publicar.** O `archiveEpoch` deu 403 só em produção
  porque em rules ler chave inexistente lança erro; com `npm run emu:rules`
  isso apareceria em segundos.

## Gotchas

- O navegador embutido do Claude Code **bloqueia requisição entre portas
  locais**, então o preview dele não alcança o emulador. Use o Chrome normal —
  ali funciona. (O emulador em si responde: `curl 127.0.0.1:8080` dá 200.)
- O emulador é **efêmero**: ao parar, os dados somem. Rode o seed de novo.
  Para persistir: `firebase emulators:start --only firestore --export-on-exit=./emulator-data --import=./emulator-data`
- `.firebase/`, `*-debug.log` e `emulator-data/` estão no `.gitignore`.

Ver também: [[teto-1mb-doc-apostas]] (por que o doc era grande) e a skill
`firestore-safety`.
