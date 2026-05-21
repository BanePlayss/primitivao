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

// `interests` agora vive em campo top-level no doc (sibling do `json`),
// pra escapar de races com outras escritas. Lemos top-level; fallback ao
// formato antigo (dentro do json) pra retrocompat.
const apostasData = parseJsonField(betSnap);
const rawBetData = betSnap.exists ? betSnap.data() : {};
if (apostasData && typeof apostasData === 'object') {
  const topInterests = rawBetData.interests;
  if (topInterests && typeof topInterests === 'object') {
    apostasData.interests = topInterests;
  } else if (!apostasData.interests) {
    apostasData.interests = {};
  }
}

const payload = {
  exportedAt: new Date().toISOString(),
  version: 3,
  source: 'github-action',
  apostas:       apostasData,
  classificacao: parseJsonField(classifSnap),
};

const date = new Date().toISOString().slice(0, 10);
mkdirSync('backups', { recursive: true });
const file = `backups/${date}.json`;
writeFileSync(file, JSON.stringify(payload, null, 2));

const users = Object.keys(payload.apostas?.users || {}).length;
const bets  = (payload.apostas?.bets || []).length;
const interestsCount = Object.values(payload.apostas?.interests || {})
                              .reduce((s, x) => s + Object.keys(x || {}).length, 0);
console.log(`Wrote ${file} — ${users} users, ${bets} bets, ${interestsCount} inscricoes.`);
