"""Merge de dois backups: pega o `apostas` (users/bets/teamPlayers/fixtures)
de um arquivo "mais recente" e sobrepõe o `interests` de um arquivo "anterior".

Útil quando uma corrupção do doc zerou as inscrições mas as apostas continuam
corretas no backup mais novo.
"""
import json
import os
import sys

NEW   = r"D:\projects\primitivao\backups\2026-05-25.json"   # apostas/users certos
OLD   = r"D:\projects\primitivao\backups\2026-05-24.json"   # interests certos
OUT   = r"D:\projects\primitivao\backups\primitivao-backup-MERGED-2026-05-25.json"

with open(NEW, encoding='utf-8') as f:
    new = json.load(f)
with open(OLD, encoding='utf-8') as f:
    old = json.load(f)

# Estrutura do backup: { exportedAt, version, source, apostas, classificacao, ...}
# apostas = { users, fixtures, bets, teamPlayers, interests }
new_apostas = (new.get('apostas') or {}).copy()
old_interests = (old.get('apostas') or {}).get('interests') or {}

# Override: pega interests do antigo
new_apostas['interests'] = old_interests

merged = {
    "exportedAt": new.get('exportedAt'),
    "version": new.get('version', 3),
    "source": f"merge:{os.path.basename(NEW)}+interests({os.path.basename(OLD)})",
    "apostas": new_apostas,
    "classificacao": new.get('classificacao'),
}

# Stats
users = len(new_apostas.get('users') or {})
bets  = len(new_apostas.get('bets')  or [])
interests_total = sum(len(v) for v in old_interests.values() if isinstance(v, dict))

print(f"Merge:")
print(f"  base: {os.path.basename(NEW)} ({users} users, {bets} bets)")
print(f"  +    : interests de {os.path.basename(OLD)} ({interests_total} inscritos em {len(old_interests)} campeonatos)")

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(merged, f, indent=2, ensure_ascii=False)

size = os.path.getsize(OUT)
print(f"OK -> {OUT} ({size} bytes)")
