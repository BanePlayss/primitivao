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
const csSnap = await getDoc(doc(db, 'primitivao', 'state'));
if (!csSnap.exists()) { console.log('sem state'); process.exit(1); }
const cs = JSON.parse(csSnap.data().json || '{}');
const rounds = cs.rounds || [];
console.log('total rodadas:', rounds.length);
rounds.forEach((r, i) => {
  console.log(`\n=== RODADA ${i+1} ===`);
  r.forEach(g => {
    const played = g.gh !== '' && g.ga !== '';
    console.log(`  ${g.day} ${g.date} ${g.time}  ${g.home.toUpperCase()} ${played ? g.gh+' x '+g.ga : '_ x _'} ${g.away.toUpperCase()}`);
  });
});

// Classificação atual
const TEAMS = ['bane','mohamed','potato','magreza','celin','juca','caco','vitinho'];
const rec = {};
TEAMS.forEach(t => rec[t] = { id: t, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, p: 0 });
rounds.forEach(r => r.forEach(m => {
  const gh = parseInt(m.gh, 10), ga = parseInt(m.ga, 10);
  if (Number.isNaN(gh) || Number.isNaN(ga)) return;
  const H = rec[m.home], A = rec[m.away];
  H.j++; A.j++;
  H.gp += gh; H.gc += ga;
  A.gp += ga; A.gc += gh;
  if (gh > ga) { H.v++; A.d++; H.p += 3; }
  else if (gh < ga) { A.v++; H.d++; A.p += 3; }
  else { H.e++; A.e++; H.p++; A.p++; }
}));
const sorted = Object.values(rec).sort((a,b) => b.p - a.p || (b.gp-b.gc) - (a.gp-a.gc) || b.gp - a.gp);
console.log('\n=== CLASSIFICAÇÃO ATUAL ===');
console.log('# | TIME    | J  V  E  D | GP GC SG | PTS');
sorted.forEach((s, i) => {
  console.log(`${i+1} | ${s.id.padEnd(7)} | ${s.j}  ${s.v}  ${s.e}  ${s.d} | ${String(s.gp).padStart(2)} ${String(s.gc).padStart(2)} ${(s.gp-s.gc>=0?'+':'')+(s.gp-s.gc)} | ${s.p}`);
});
process.exit(0);
