---
name: firestore-safety
description: Safely read and write the Primitivão Firestore (docs primitivao/apostas and primitivao/state) without losing data. Use BEFORE touching any persistence code — commitBetDocUpdate, the onSnapshot loaders, backup/restore, wipe, or the security rules. Encodes the exact landmines that already caused data-loss scares.
---

# Firestore — segurança (NÃO QUEBRAR)

Dois docs:
- `primitivao/apostas`: `json` stringificado (`users`, `bets`, `teamPlayers`,
  `fixtures`) + campos TOP-LEVEL (siblings do json): `interests`, `comments`,
  `worldcup`, `news`, `discord_webhook`.
- `primitivao/state`: `json` com `rounds` / `currentRound` (a classificação).

## commitBetDocUpdate(reducer) — toda escrita no json passa por aqui
Reducer pode retornar:
- `null`/`undefined` → no-op
- `{ __abort: true, result }` → no-op, devolve `result` pro caller (ex: senha errada)
- estado direto (`{ ...remote, bets }`) → grava
- `{ next: <estado> }` → grava `next` (write-back)
O helper **desempacota `out.next`** — NUNCA grave `out` direto. `protectMap` recusa
gravar `{}` em `users`/`teamPlayers` se o remoto tinha entradas. (CLAUDE.md §2.2.)

## Landmine: onSnapshot + `!snap.exists` (já causou "reset" aparente)
Um snapshot pode chegar com `exists=false` **transiente** (cache na 1ª conexão,
reconexão offline→online, avaliação de regras). NUNCA tratar como "seed/reset":
1. Já carregou dados reais (`hasLoadedRef`/`csLoadedRef`)? → **ignora** (transiente).
2. `snap.metadata.fromCache`? → **não cria nada**, segura a tela "CONECTANDO".
3. Só cria o doc quando o **servidor** confirma ausência, e com `{ merge: true }`.
(CLAUDE.md §2.3.)

## Campos top-level
Escrever SEMPRE com `.set(..., { merge: true })` — `set` sem merge apaga os siblings
(já quase apagou news/webhook). Backup (`downloadFullBackup` + scripts/backup-
firestore.mjs) tem que cobrir o json + TODOS os top-level.

## Restore / Wipe
`restoreFromBackup` e `wipeAllData` fazem **backup ANTES** e abortam se o backup
falhar. `wipeAllData` usa `merge:true` (preserva news/webhook). Só via painel admin.

## Rules (firestore.rules)
`delete: if false` nos 2 docs. `notWipingJson`: a escrita não pode encolher o json
abaixo de 40% do anterior (anti-"rm -rf" pelo console). **Só valem se publicadas no
Firebase Console** — confirmar lá (o arquivo no repo pode estar à frente do live).

## Inspecionar dados ao vivo (read-only, sem instalar nada)
O doc é de leitura pública; dá pra ler via REST com a apiKey:
```
curl -s "https://firestore.googleapis.com/v1/projects/primitivao/databases/(default)/documents/primitivao/apostas?key=AIzaSyB4Tu-OIAfBUfzdtY-wF9tSoBwP_36hdRg"
```
Útil pra confirmar se houve perda de dado (updateTime + contagem de users/bets).
