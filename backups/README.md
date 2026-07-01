# Backups

Snapshots diários do Firestore (gerados pelo workflow `.github/workflows/backup-firestore.yml`).

- Formato: um arquivo `YYYY-MM-DD.json` por dia.
- Conteúdo: `apostas` (users, fixtures, bets) + `classificacao` (rounds, currentRound).
- Rotação: o script mantém os últimos **90 dias** + o snapshot do **dia 1º de
  cada mês** (histórico mensal permanente). O resto é apagado automaticamente
  na rodada seguinte do workflow. Os blobs antigos continuam no histórico do
  git — a rotação limpa o checkout e a listagem, não o `.git`.
- Como restaurar: leia o JSON, escreva de volta no doc Firestore correspondente — o app já espera o mesmo schema serializado no campo `json` do doc.

Também dá pra baixar manualmente um snapshot na hora pelo botão **ADMIN → BACKUP → ↓ BAIXAR BACKUP JSON** no app.
