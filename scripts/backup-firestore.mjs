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

// Campos top-level no doc primitivao/apostas (sibling do `json` stringificado):
//   - interests       : inscrições em campeonatos futuros
//   - comments        : comentários por news
//   - worldcup        : { results, picks } — bolão da Copa do Mundo
//   - news            : array de news publicadas (CMS-light)
//   - discord_webhook : URL do webhook do Discord
// Lemos cada um e fundimos com o json parseado pra um backup completo.
const apostasData = parseJsonField(betSnap);
const rawBetData = betSnap.exists ? betSnap.data() : {};
if (apostasData && typeof apostasData === 'object') {
  const topInterests      = rawBetData.interests;
  const topComments       = rawBetData.comments;
  const topWorldcup       = rawBetData.worldcup;
  const topNews           = rawBetData.news;
  const topDiscordWebhook = rawBetData.discord_webhook;

  apostasData.interests = (topInterests && typeof topInterests === 'object')
    ? topInterests
    : (apostasData.interests || {});

  apostasData.comments = (topComments && typeof topComments === 'object')
    ? topComments
    : (apostasData.comments || {});

  // Copa do Mundo: { results: {fixtureId: {gh,ga}}, picks: {nick: {fixtureId: {gh,ga}}} }
  // Esse é o campo crítico pra não perder palpites do bolão da Copa.
  apostasData.worldcup = (topWorldcup && typeof topWorldcup === 'object')
    ? { results: topWorldcup.results || {}, picks: topWorldcup.picks || {} }
    : (apostasData.worldcup || { results: {}, picks: {} });

  if (Array.isArray(topNews)) apostasData.news = topNews;
  if (typeof topDiscordWebhook === 'string') apostasData.discord_webhook = topDiscordWebhook;
}

const payload = {
  exportedAt: new Date().toISOString(),
  version: 4,
  source: 'github-action',
  apostas:       apostasData,
  classificacao: parseJsonField(classifSnap),
};

const date = new Date().toISOString().slice(0, 10);
mkdirSync('backups', { recursive: true });
const file = `backups/${date}.json`;
writeFileSync(file, JSON.stringify(payload, null, 2));

const users          = Object.keys(payload.apostas?.users || {}).length;
const bets           = (payload.apostas?.bets || []).length;
const interestsCount = Object.values(payload.apostas?.interests || {})
                              .reduce((s, x) => s + Object.keys(x || {}).length, 0);
const wcPicksTotal   = Object.values(payload.apostas?.worldcup?.picks || {})
                              .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0);
const wcResultsTotal = Object.keys(payload.apostas?.worldcup?.results || {}).length;
const commentsTotal  = Object.values(payload.apostas?.comments || {})
                              .reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
const newsCount      = Array.isArray(payload.apostas?.news) ? payload.apostas.news.length : 0;

console.log(`Wrote ${file}`);
console.log(`  users:        ${users}`);
console.log(`  bets:         ${bets}`);
console.log(`  inscricoes:   ${interestsCount}`);
console.log(`  copa picks:   ${wcPicksTotal} (${Object.keys(payload.apostas?.worldcup?.picks || {}).length} usuarios)`);
console.log(`  copa results: ${wcResultsTotal} jogos`);
console.log(`  comments:     ${commentsTotal}`);
console.log(`  news:         ${newsCount}`);

// Verificação dura: se tem usuarios com palpites na Copa, garantir que o
// backup contém. Se o número saiu zero quando antes tinha, falha o job
// pra alertar (não sobrescreve o backup do dia anterior, mas avisa).
if (wcPicksTotal === 0 && Object.keys(payload.apostas?.users || {}).length > 0) {
  console.warn('⚠ ALERTA: backup tem usuarios mas ZERO palpites da Copa. Pode ser normal (ninguem palpitou ainda) ou pode ser perda de dados.');
}
