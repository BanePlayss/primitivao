// Anuncia um jogo que vai acontecer: cria news no INÍCIO + posta no
// Discord via webhook configurado no Firestore. Mantém as news existentes.
//
// Uso: edita o objeto ANNOUNCE abaixo e roda:
//   node scripts/announce-game.mjs

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB4Tu-OIAfBUfzdtY-wF9tSoBwP_36hdRg",
  authDomain: "primitivao.firebaseapp.com",
  projectId: "primitivao",
  storageBucket: "primitivao.firebasestorage.app",
  messagingSenderId: "279022752580",
  appId: "1:279022752580:web:e5f467d6e2e83bc6cc7d11",
};

// ────────────────────────────────────────────────────────────────
const ANNOUNCE = {
  newsId: 'bane-vs-caco-prejogo',
  title: 'HOJE: BANE × CACO — DOIS TÍTULOS, UM DESTINO',
  subtitle: 'O confronto da rodada começa às 20h15 BRT. Cupom tá aberto, odds tão na mesa, hora de mostrar de que lado você joga.',
  tag: 'PRÉVIA',
  date: '27/05/2026',
  image: '', // adicione 'news/bane-vs-caco.jpg' depois quando gerar
  body: `**Atenção, povo do Primitivão**: em UMA HORA a bola rola pra um dos clássicos da temporada. **BANE × CACO**, hoje, **às 20h15 BRT**.

De um lado, **BANE** chega de braços cruzados, olhar firme, mantendo a postura de quem já viu tudo no campeonato. Do outro, **CACO**, mão no bolso, vibe relaxada, aquele cara que parece nem ligar — mas marca na hora exata.

Quem leva os 3 pontos hoje sobe na tabela. Quem perde, dorme pensando.

**O QUE FAZER AGORA:**

- Confere as odds em **CAMPEONATOS → FIFA → JOGOS**
- Monta teu cupom (lembra: combinar mercados do mesmo jogo dá pra fazer)
- Compartilha teu palpite no Discord pra os outros virem zoar quando der errado

Em uma hora a bola rola. Cupom fechado quando o admin travar o jogo. Bora.`,
  // Mensagem que vai pro Discord (curtinha, com link)
  discordMessage: `**HOJE 20h15 BRT: BANE × CACO**
Dois títulos, um destino. Cupom aberto agora.
Vai lá apostar: https://baneplayss.github.io/primitivao/apostas/`,
};
// ────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ref = doc(db, 'primitivao', 'apostas');
const snap = await getDoc(ref);

if (!snap.exists()) {
  console.error('Doc primitivao/apostas não existe.');
  process.exit(1);
}

const data = snap.data() || {};
const currentNews = Array.isArray(data.news) ? data.news : [];

// Remove versão antiga dessa mesma announce (se já tiver) e adiciona no topo
const filteredNews = currentNews.filter(n => n.id !== ANNOUNCE.newsId);
const newNews = {
  id: ANNOUNCE.newsId,
  title: ANNOUNCE.title,
  subtitle: ANNOUNCE.subtitle,
  date: ANNOUNCE.date,
  tag: ANNOUNCE.tag,
  image: ANNOUNCE.image,
  body: ANNOUNCE.body,
  at: Date.now(),
};
const updatedNews = [newNews, ...filteredNews];

await setDoc(ref, { news: updatedNews }, { merge: true });
console.log('✓ News publicada/atualizada (' + ANNOUNCE.newsId + ')');

// Posta no Discord se webhook estiver configurado
const webhook = data.discord_webhook;
if (webhook && webhook.startsWith('https://discord.com/api/webhooks/')) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: ANNOUNCE.discordMessage,
        username: 'Primitivão',
      }),
    });
    if (res.ok) {
      console.log('✓ Posted no Discord');
    } else {
      const txt = await res.text();
      console.warn('✗ Discord retornou HTTP ' + res.status + ': ' + txt.slice(0, 200));
    }
  } catch (e) {
    console.warn('✗ Falha ao postar no Discord:', e.message);
  }
} else {
  console.log('(sem webhook do Discord configurado, pulando post)');
}

process.exit(0);
