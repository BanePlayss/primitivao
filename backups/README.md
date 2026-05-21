# Backups

Snapshots diários do Firestore (gerados pelo workflow `.github/workflows/backup-firestore.yml`).

- Formato: um arquivo `YYYY-MM-DD.json` por dia.
- Conteúdo: `apostas` (users, fixtures, bets) + `classificacao` (rounds, currentRound).
- Como restaurar: leia o JSON, escreva de volta no doc Firestore correspondente — o app já espera o mesmo schema serializado no campo `json` do doc.

Também dá pra baixar manualmente um snapshot na hora pelo botão **ADMIN → BACKUP → ↓ BAIXAR BACKUP JSON** no app.
