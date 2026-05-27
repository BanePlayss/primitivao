// Publica uma news direto no Firestore (top-level field `news` do doc
// primitivao/apostas), usando o Firebase Web SDK.
//
// Autenticação: não precisa de service account — as Firestore rules
// permitem update se o payload passar na validação estrutural (campo
// `json` continua string, tamanho compatível, etc), e como esse script
// só adiciona ao array `news` sem mexer no resto, passa direto.
//
// Uso: node scripts/publish-news.mjs

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
// EDITAR AQUI: o conteúdo da news que vai ser publicada
// ────────────────────────────────────────────────────────────────
const NEW_NEWS = {
  id: 'avatares-lancamento-' + Date.now(),
  title: 'NASCEM OS 8 CARTOONS DO PRIMITIVÃO',
  subtitle: 'Cada jogador agora tem versão oficial em estilo Cartoon Network — saíram direto do Dexter\'s Laboratory pro topo da sua tela.',
  tag: 'EDIÇÃO',
  date: '27/05/2026',
  image: 'news/lancamento_avatares.jpg',
  body: `A redação do PRIMITIVÃO TIMES não acreditou: depois de meses de campeonato sem rosto, finalmente cada jogador tem o que merece — um AVATAR oficial em estilo Cartoon Network anos 2000, daqueles bem Dexter, Powerpuff, Samurai Jack.

Cada uma das oito feras agora aparece personalizada no topo da página, no Ranking Geral e no Hall da Fama (ou da Vergonha, conforme o caso).

Bane apareceu de braços cruzados, olhar firme — postura de quem já viu tudo. Mohamed surgiu com a mão na cabeça e expressão de derrota — coincidência ou efeito colateral direto dos −33 SG? Juca veio no modo triunfante, peito estufado, como se cada gol da goleada ainda tivesse sido marcado por ele agora. Celin estampa aquele smirk cínico que deixa todo mundo na dúvida se é zoeira de amigo ou tramoia em andamento.

Magreza tá lá em modo carreira, expressão séria, sem tempo pra brincadeira. Potato encostado tipo parede, mão no bolso, vibe descolada. Caco relaxado também, postura de quem leva tudo na esportiva. E Vitinho? Cabeça inclinada, olhar de moleque que sabe das coisas e não vai contar pra ninguém.

Cada um saiu vestindo a cor oficial do seu time. Detalhe importante: em breve vai abrir uma LOJA pra usar os PCs (que tanto custaram pra acumular) na compra de itens cosméticos — chapéus, molduras, distintivos. E o melhor: alguns itens lendários NÃO vão estar à venda. Coroa do rei só pinga pra quem for campeão da temporada. Lanterna estampada só sobra pro último colocado do Hall da Vergonha. Mereceu — usou.

Bora ver como cada um ficou? Olha no topo da página agora.`,
  at: Date.now(),
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

const current = snap.data() || {};
const currentNews = Array.isArray(current.news) ? current.news : [];

// Confere se já tem uma news com mesmo id (idempotência manual)
const dup = currentNews.find(n => n.id && n.id.startsWith('avatares-lancamento-'));
if (dup) {
  console.log('Já tem news de avatares no Firestore (id=' + dup.id + '). Saindo sem mexer.');
  process.exit(0);
}

const updatedNews = [NEW_NEWS, ...currentNews];
await setDoc(ref, { news: updatedNews }, { merge: true });

console.log('OK: news publicada com id=' + NEW_NEWS.id);
console.log('Total de news agora: ' + updatedNews.length);
process.exit(0);
