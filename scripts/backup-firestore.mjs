// Daily Firestore backup — usado pelo GitHub Action `.github/workflows/backup-firestore.yml`.
// Lê os dois docs (apostas + state) e grava `backups/YYYY-MM-DD.json` no repo.
// Auth: service account JSON em process.env.FIREBASE_SA_KEY (GitHub Secret).

import admin from 'firebase-admin';
import { writeFileSync, mkdirSync } from 'node:fs';

const saRaw = process.env.FIREBASE_SA_KEY;
if (!saRaw) {
  console.error('FIREBASE_SA_KEY env var is missing');
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(saRaw);
} catch (e) {
  console.error('FIREBASE_SA_KEY is not valid JSON:', e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const [betSnap, classifSnap] = await Promise.all([
  db.doc('primitivao/apostas').get(),
  db.doc('primitivao/state').get(),
]);

const parseJsonField = (snap) => {
  if (!snap.exists) return null;
  const raw = snap.data().json;
  if (typeof raw !== 'string') return snap.data();
  try { return JSON.parse(raw); }
  catch (e) { return { _parseError: e.message, _raw: raw }; }
};

const payload = {
  exportedAt: new Date().toISOString(),
  version: 1,
  source: 'github-action',
  apostas:       parseJsonField(betSnap),
  classificacao: parseJsonField(classifSnap),
};

const date = new Date().toISOString().slice(0, 10);
mkdirSync('backups', { recursive: true });
const file = `backups/${date}.json`;
writeFileSync(file, JSON.stringify(payload, null, 2));

const users = Object.keys(payload.apostas?.users || {}).length;
const bets  = (payload.apostas?.bets || []).length;
console.log(`Wrote ${file} — ${users} users, ${bets} bets.`);
