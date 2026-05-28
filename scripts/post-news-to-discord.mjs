// Posta uma news do Firestore no canal do Discord via webhook.
// Lê a news pelo id, monta payload com embed (title, subtitle, body, image)
// e envia. Webhook URL vem do Firestore (campo discord_webhook).
//
// Uso:
//   node scripts/post-news-to-discord.mjs <newsId>
//
// Exemplo:
//   node scripts/post-news-to-discord.mjs mk-edicao-01-inscricoes

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyB4Tu-OIAfBUfzdtY-wF9tSoBwP_36hdRg',
  authDomain: 'primitivao.firebaseapp.com',
  projectId: 'primitivao',
  storageBucket: 'primitivao.firebasestorage.app',
  messagingSenderId: '279022752580',
  appId: '1:279022752580:web:e5f467d6e2e83bc6cc7d11',
};

const SITE_BASE = 'https://baneplayss.github.io/primitivao/apostas/';
const newsId = process.argv[2];

if (!newsId) {
  console.error('Uso: node scripts/post-news-to-discord.mjs <newsId>');
  console.error('Exemplo: node scripts/post-news-to-discord.mjs mk-edicao-01-inscricoes');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const snap = await getDoc(doc(db, 'primitivao', 'apostas'));
if (!snap.exists()) {
  console.error('Doc primitivao/apostas não existe.');
  process.exit(1);
}

const data = snap.data();
const news = Array.isArray(data.news) ? data.news : [];
const item = news.find(n => n.id === newsId);

if (!item) {
  console.error(`News com id="${newsId}" não encontrada.`);
  console.error('Ids disponíveis:');
  news.forEach(n => console.error(`  - ${n.id}`));
  process.exit(1);
}

const webhook = data.discord_webhook;
if (!webhook || !webhook.startsWith('https://discord.com/api/webhooks/')) {
  console.error('discord_webhook não configurado no Firestore (ou URL inválida).');
  console.error('Configure em ADMIN → DISCORD → URL DO WEBHOOK.');
  process.exit(1);
}

// Discord aceita até 2000 chars em content e 4096 em embed.description.
// Vamos usar embed pra ficar bonito + cobrir textos longos.
// Discord markdown: **bold** e listas com - funcionam nativo.
const body = item.body || '';
const imageUrl = item.image ? (SITE_BASE + item.image.replace(/^\/+/, '')) : null;

const embed = {
  title: item.title || 'Primitivão Times',
  description: body.length > 4000 ? body.slice(0, 3997) + '...' : body,
  color: 0xd76414, // burnt orange (Primitivão)
  url: SITE_BASE,
  footer: { text: 'Primitivão Times · ' + (item.tag || 'EDIÇÃO') + ' · ' + (item.date || '') },
};

if (item.subtitle) {
  embed.description = '*' + item.subtitle + '*\n\n' + embed.description;
}

if (imageUrl) {
  embed.image = { url: imageUrl };
}

const payload = {
  username: 'Primitivão Times',
  // content curto fora do embed pra ficar mais visível na notificação
  content: '**NOVA EDIÇÃO!** ' + (item.title || 'Confira a novidade'),
  embeds: [embed],
};

// Discord recomenda Content-Type application/json explícito
const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

if (res.ok) {
  console.log('✓ News "' + item.title + '" postada no Discord.');
  if (imageUrl) console.log('  imagem: ' + imageUrl);
} else {
  const txt = await res.text().catch(() => '');
  console.error('✗ Discord retornou HTTP ' + res.status);
  console.error('  ' + txt.slice(0, 500));
  process.exit(1);
}

process.exit(0);
