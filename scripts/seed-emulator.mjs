// Semeia o EMULADOR do Firestore com um backup real do Primitivao.
// Uso: node scripts/seed-emulator.mjs [caminho-do-backup.json]
// Sem argumento, pega o backup mais recente de backups/.
//
// O emulador expoe a MESMA API REST do Firestore em 127.0.0.1:8080, sem auth.
// Nunca aponta pra producao: o host e fixo em 127.0.0.1 de proposito.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HOST = '127.0.0.1:8080';
const PROJ = 'primitivao';
const BASE = `http://${HOST}/v1/projects/${PROJ}/databases/(default)/documents`;

// --- escolhe o backup ---
let file = process.argv[2];
if (!file) {
  const cands = readdirSync('backups')
    .filter(f => f.endsWith('.json') && !f.startsWith('README'))
    .sort();
  if (!cands.length) { console.error('nenhum backup em backups/'); process.exit(1); }
  file = join('backups', cands[cands.length - 1]);
}
console.log('semeando com:', file);
const bk = JSON.parse(readFileSync(file, 'utf8'));

// --- JS puro -> value-wrapper do Firestore ---
function wrap(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(wrap) } };
  const fields = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) fields[k] = wrap(x);
  return { mapValue: { fields } };
}

async function put(path, fields) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return path;
}

// --- monta o doc de apostas igual a producao: `json` + os TOP-LEVEL ---
const ap = bk.apostas || {};
const { interests, comments, worldcup, news, discord_webhook, ...rest } = ap;
const apostasFields = {
  json: wrap(JSON.stringify(rest)),
  interests: wrap(interests || {}),
  comments: wrap(comments || {}),
  worldcup: wrap(worldcup || { results: {}, picks: {} }),
  updatedAt: wrap(Date.now()),
};
if (Array.isArray(news)) apostasFields.news = wrap(news);
if (typeof discord_webhook === 'string') apostasFields.discord_webhook = wrap(discord_webhook);

try {
  await put('primitivao/apostas', apostasFields);
  console.log('  primitivao/apostas   ok  (users=' + Object.keys(rest.users || {}).length
    + ' bets=' + (rest.bets || []).length + ')');

  if (bk.classificacao) {
    await put('primitivao/state', { json: wrap(JSON.stringify(bk.classificacao)), updatedAt: wrap(Date.now()) });
    console.log('  primitivao/state     ok  (rounds=' + (bk.classificacao.rounds || []).length + ')');
  }
  if (bk.avatars && Object.keys(bk.avatars).length) {
    await put('primitivao/avatars', Object.fromEntries(Object.entries(bk.avatars).map(([k, v]) => [k, wrap(v)])));
    console.log('  primitivao/avatars   ok  (' + Object.keys(bk.avatars).length + ')');
  }
  if (bk.championships) {
    await put('primitivao/championships', { json: wrap(JSON.stringify(bk.championships)), updatedAt: wrap(Date.now()) });
    console.log('  primitivao/championships ok');
  }
} catch (e) {
  console.error('\nFALHOU:', e.message);
  console.error('O emulador esta rodando? -> npm run emu');
  process.exit(1);
}
console.log('\npronto. abre o dev.html apontando pro emulador (dev-emu.html).');
