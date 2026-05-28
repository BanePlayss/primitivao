// Publica/sincroniza o array de news no Firestore (top-level field `news`
// do doc primitivao/apostas), usando o Firebase Web SDK.
//
// IMPORTANTE: este script faz SET COMPLETO do array `news`. Se você
// adicionou news pelo painel admin que não estão aqui, elas serão perdidas.
// Pra adicionar uma nova mantendo as outras, edite o array NEWS abaixo
// com TODAS as news que devem ficar no site, em ordem cronológica
// decrescente (mais nova primeiro).
//
// Autenticação: não precisa de service account. Firestore rules permitem
// update se o payload passar na validação estrutural.
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
// EDITAR AQUI: array completo de news (mais nova primeiro).
// Markdown suportado no body: **negrito**, listas com "- linha",
// parágrafos separados por linha em branco.
// ────────────────────────────────────────────────────────────────
const NEWS = [
  {
    id: 'mk-edicao-01-inscricoes',
    title: 'MORTAL KOMBAT · EDIÇÃO 01 — INSCRIÇÕES NO ÚLTIMO ROUND!',
    subtitle: 'Domingo às 23h59 baixa o pano. Quem não entrou ainda corre, porque o primeiro torneio de MK do Primitivão tá saindo do papel.',
    tag: 'EDIÇÃO 01 · MORTAL KOMBAT',
    date: '28/05/2026',
    image: 'news/mk-s1-r01.jpg',
    body: `**MORTAL KOMBAT TÁ NA HORA, MEU FILHO.**

A **EDIÇÃO 01** do Mortal Kombat do Primitivão tá saindo do papel — e as inscrições **se encerram DOMINGO ÀS 23H59**. Quem não entrar até lá vai ficar de fora vendo os outros se matarem em modo Fatality.

**COMO FUNCIONA:**

- **Eliminatória direta** — perdeu, foi
- **Melhor de 3 lutas** por confronto
- **Personagens livres** — escolhe quem quiser, ninguém marca presença
- **Chaves sorteadas** após o fechamento das inscrições
- **Fatality obrigatória ao vencer** — quem não terminar o oponente perde o respeito

**PRÊMIO:** o campeão leva o **badge FATALITY MASTER** — primeiro e único da Edição 01. Vai aparecer estampado no avatar pra eternidade (ou até a Edição 02). Quem perder a final ainda leva um **badge VICE-FIGHTER** de consolação.

**JÁ TÁ DENTRO?** A lista tá crescendo. Mas só sai do papel domingo às 23h59 — depois disso, sem choro, sem retorno, sem segundo round. Fica esperto.

**COMO ENTRAR:** corre no **DISCORD** e fala com a comissão. Em 30 segundos você tá inscrito.

Domingo o sangue corre. **Quem vai aparecer pro First Blood?**`,
    at: Date.parse('2026-05-28T01:30:00-03:00'),
  },
  {
    id: 'ultima-rodada-vol-09',
    title: 'ÚLTIMA RODADA — VOL. 09 DO PRIMITIVÃO TIMES',
    subtitle: 'Bane ripou todo mundo nas apostas, Juca já é campeão e Mohamed FC afunda em −33. Segunda tem FIFA pra fechar a temporada.',
    tag: 'PRIMITIVÃO TIMES · VOL. 09',
    date: '28/05/2026',
    image: 'news/last_edition.jpg',
    body: `**ÚLTIMA RODADA E O JOGO DE HOJE PEGOU FOGO!**

**BANE 4 × 3 CACO** — SETE gols, coração na boca e decisão no detalhe. O Caco veio com sangue no olho, brigou no placar do início ao fim, mas o Bane foi mais frio na hora de carimbar e levou o jogo mais quente da rodada.

E não parou no campo, não: o **Bane RIPOU TODO MUNDO NAS APOSTAS** também. Levou o jogo e levou a banca junto. Dia perfeito.

E pra fechar em grande estilo... **SAIU A EDIÇÃO FINAL DO PRIMITIVÃO TIMES — VOL. 09!** Olha o que tá bombando na tabela:

- **JUCA JÁ É CAMPEÃO MATEMÁTICO!** 18 pts, 100% de aproveitamento, +36 de saldo. Título no bolso, não tem mais jeito.
- **POTATO** segura o vice quase certo com 13 pts — só um milagre tira.
- A **DISPUTA PELO 3º** incendiou: Magreza (10) na frente, Celin (9) colado. Decidido no detalhe.
- E lá no fundo do poço... **MOHAMED FC AFUNDA EM −33** de saldo. Lanterna matemático, 0 ponto, 6 derrota. Vexame carimbado e moldurado.

E o aviso que importa: **SEGUNDA TEM FIFA!** TODOS NO DISCORD pra fechar essa temporada com a resenha que ela merece.`,
    at: Date.parse('2026-05-28T00:45:00-03:00'),
  },
  {
    id: 'avatares-lancamento',
    title: 'NASCEM OS 8 CARTOONS DO PRIMITIVÃO',
    subtitle: 'Cada jogador agora tem versão oficial em estilo Cartoon Network — saíram direto do Dexter\'s Laboratory pro topo da sua tela.',
    tag: 'EDIÇÃO',
    date: '27/05/2026',
    image: 'news/avatares_noticia.jpg',
    body: `A redação do **PRIMITIVÃO TIMES** não acreditou: depois de meses de campeonato sem rosto, finalmente cada jogador tem o que merece — um AVATAR oficial em estilo Cartoon Network anos 2000, daqueles bem Dexter, Powerpuff, Samurai Jack.

Cada uma das oito feras agora aparece personalizada no topo da página, no Ranking Geral e no Hall da Fama (ou da Vergonha, conforme o caso).

**Bane** apareceu de braços cruzados, olhar firme — postura de quem já viu tudo. **Mohamed** surgiu com a mão na cabeça e expressão de derrota — coincidência ou efeito colateral direto dos −33 SG? **Juca** veio no modo triunfante, peito estufado, como se cada gol da goleada ainda tivesse sido marcado por ele agora. **Celin** estampa aquele smirk cínico que deixa todo mundo na dúvida se é zoeira de amigo ou tramoia em andamento.

**Magreza** tá lá em modo carreira, expressão séria, sem tempo pra brincadeira. **Potato** encostado tipo parede, mão no bolso, vibe descolada. **Caco** relaxado também, postura de quem leva tudo na esportiva. E **Vitinho**? Cabeça inclinada, olhar de moleque que sabe das coisas e não vai contar pra ninguém.

Cada um saiu vestindo a cor oficial do seu time. Detalhe importante: em breve vai abrir uma **LOJA** pra usar os PCs (que tanto custaram pra acumular) na compra de itens cosméticos — chapéus, molduras, distintivos. E o melhor: alguns itens lendários NÃO vão estar à venda. Coroa do rei só pinga pra quem for campeão da temporada. Lanterna estampada só sobra pro último colocado do Hall da Vergonha. Mereceu — usou.

Bora ver como cada um ficou? Olha no topo da página agora.`,
    at: Date.parse('2026-05-27T18:00:00-03:00'),
  },
  {
    id: 'edicao-08-escandalo',
    title: 'ESCÂNDALO EM CAMPO! CELIN MANIPULOU O RESULTADO??',
    subtitle: 'Juca 4 × 0 Celin · aos 88 min Celin "desaba" e leva 3 gols num lance só. Coincidência ou entregada?',
    tag: 'PRIMITIVÃO TIMES · VOL. 08',
    date: '25/05/2026',
    image: 'news/edicao-08-escandalo.jpg',
    body: `Edição especial do **Primitivão Times** com tudo o que tá rolando na temporada:

- **Celin manipulou?** Segurou o jogo a tarde inteira pra não tomar gol — aos 88 min levou 3 e fechou Juca 4 × 0 Celin. "Coincidência ou entregada?"
- **Mohamed alcança −33 SG** após derrota amarga contra o Magreza. 0 vitórias, 6 derrotas. Vai encerrar com −50?
- **Juca on fire!** 4 jogos, 4 goleadas, 100% de zoeira.
- **Magreza em modo carreira:** nem piedade, nem desculpa.
- **Comissão do VARIMITIVÃO** de plantão: "errou de novo? não foi erro, foi intenção!"
- **Futmercado bombando** — rumores, trocas e negociações de padaria.
- **Próximo jogo:** BANE × CACO. Dois títulos, um destino.

Acompanha tudo na aba **CAMPEONATOS → FIFA** — classificação, jogos abertos e o Hall da Vergonha em tempo real.`,
    at: Date.parse('2026-05-25T12:00:00-03:00'),
  },
  {
    id: 'bonus-semanal',
    title: '+500 PC NA CONTA, MEU FILHO!',
    subtitle: 'O xamã liberou o cofre — não esquece de checar antes da rodada.',
    tag: 'PROMO',
    date: '22/05/2026',
    image: 'news/bonus-semanal.jpg',
    body: `Todo dia **segunda-feira às 10h da manhã (BRT)** o cofre do xamã se abre e libera **500 PC de graça** pra cada jogador. É só clicar no chip **+500 PC RECLAMAR** que aparece lá no topo da página, ao lado do seu saldo.

Não perdeu? Confere também o site toda segunda — quem não reclama fica de fora até a próxima.`,
    at: Date.parse('2026-05-22T10:00:00-03:00'),
  },
  {
    id: 'primitivao-resiste',
    title: 'PRIMITIVÃO RESISTE!',
    subtitle: 'Vândalo digital apaga base de apostadores — sistema renasce maior e melhor.',
    tag: 'ATUALIZAÇÃO',
    date: '21/05/2026',
    image: 'news/primitivao-resiste.jpg',
    body: `Na calada da noite, um invasor mal-intencionado conseguiu apagar todos os usuários e inscrições do Primitivão. Mas o cofre PC resistiu! Em horas, o sistema voltou no ar com defesas reforçadas.

**O que mudou:**

- Odds **automáticas** baseadas na classificação
- 5 mercados: 1X2, Ambos Marcam, Ninguém Marca, +3 Gols (mandante/visitante)
- Bônus semanal de **500 PC** (era 20!) — toda segunda 10h BRT
- Hall da Fama e Hall da Vergonha por temporada
- Aba "Meu Perfil" com seu time, troféus e títulos
- Mortal Kombat, Rocket League, LoL, CS, Golf With Your Friends, Copa do Mundo — chegando em breve
- Otimizado pra celular (com menu hamburger)
- Defesas contra race conditions e backup automático diário`,
    at: Date.parse('2026-05-21T20:00:00-03:00'),
  },
  {
    id: 'fifa-s1',
    title: 'TEMPORADA EM ANDAMENTO: FIFA 2026 SEASON 1',
    subtitle: 'A primeira temporada já está rolando — confira os jogos da rodada atual.',
    tag: 'CAMPEONATO',
    date: '18/05/2026',
    image: '',
    body: `A primeira temporada oficial do Primitivão tá no ar. 8 jogadores, 7 rodadas, 28 jogos. Apostas abertas em cada partida até o admin travar (geralmente quando a bola vai rolar).

As **odds são calculadas em tempo real** a partir da classificação: quanto mais forte um time (pontos + saldo de gol), menor a odd dele vencer. Quando uma rodada inteira termina, as odds da próxima rodada são recalculadas automaticamente pra todo mundo no app.

Vá em **CAMPEONATOS → FIFA → JOGOS** pra apostar.`,
    at: Date.parse('2026-05-18T19:00:00-03:00'),
  },
];

// ────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ref = doc(db, 'primitivao', 'apostas');
const snap = await getDoc(ref);

if (!snap.exists()) {
  console.error('Doc primitivao/apostas não existe.');
  process.exit(1);
}

await setDoc(ref, { news: NEWS }, { merge: true });

console.log('OK: ' + NEWS.length + ' news sincronizadas no Firestore.');
NEWS.forEach((n, i) => console.log(`  ${i + 1}. ${n.date}  ${n.title}`));
process.exit(0);
