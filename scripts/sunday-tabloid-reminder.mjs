// Lembrete semanal (domingo) no Discord: avisa que sai a edição do
// PRIMITIVÃO TIMES. Lê o webhook do Firestore (campo top-level
// `discord_webhook` do doc primitivao/apostas) — o mesmo que o app usa.
// Não precisa de service account: o doc é de leitura pública.
//
// Disparado pelo GitHub Action `.github/workflows/tabloid-reminder.yml`
// (cron de domingo) ou na mão: `node scripts/sunday-tabloid-reminder.mjs`.

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyB4Tu-OIAfBUfzdtY-wF9tSoBwP_36hdRg',
  authDomain: 'primitivao.firebaseapp.com',
  projectId: 'primitivao',
  storageBucket: 'primitivao.firebasestorage.app',
  messagingSenderId: '279022752580',
  appId: '1:279022752580:web:e5f467d6e2e83bc6cc7d11',
});

const db = getFirestore(app);
const snap = await getDoc(doc(db, 'primitivao', 'apostas'));
if (!snap.exists()) {
  console.error('Doc primitivao/apostas não existe.');
  process.exit(1);
}

const webhook = snap.data().discord_webhook;
if (!webhook || !String(webhook).startsWith('https://discord.com/api/webhooks/')) {
  console.log('Sem webhook do Discord configurado — nada a postar.');
  process.exit(0);
}

const content = [
  '**DOMINGO DE PRIMITIVÃO TIMES!**',
  'A edição da semana tá saindo do forno — manchete, classificação e os confrontos da rodada com odds na mesa.',
  '',
  'Fica ligado que já já tem capa nova. E bora apostar: https://baneplayss.github.io/primitivao/apostas/',
].join('\n');

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content, username: 'Primitivão Times' }),
});

if (!res.ok) {
  const txt = await res.text();
  console.error('Discord retornou HTTP ' + res.status + ': ' + txt.slice(0, 200));
  process.exit(1);
}

console.log('Lembrete do tabloide postado no Discord.');
process.exit(0);
