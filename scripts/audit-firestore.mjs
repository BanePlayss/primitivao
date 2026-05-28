// Inspeção completa do estado atual do Firestore.
// Lista TODOS os campos top-level e dentro do `json`, com tipos e contagens.
// Útil pra auditoria: confere o que existe vs o que o backup salva.

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

const desc = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return `string (${v.length} chars)`;
  if (t === 'number' || t === 'boolean') return `${t} = ${v}`;
  if (Array.isArray(v)) return `array (${v.length} items)`;
  if (t === 'object') return `object (${Object.keys(v).length} keys: ${Object.keys(v).slice(0,8).join(', ')}${Object.keys(v).length>8?'...':''})`;
  return t;
};

console.log('═══ DOC primitivao/apostas ═══');
const snap1 = await getDoc(doc(db, 'primitivao', 'apostas'));
if (!snap1.exists()) {
  console.log('  NÃO EXISTE');
} else {
  const data = snap1.data();
  console.log('  CAMPOS TOP-LEVEL:');
  for (const [k, v] of Object.entries(data)) {
    console.log(`    ${k}: ${desc(v)}`);
  }
  console.log('\n  CONTEÚDO DO `json` (parseado):');
  try {
    const parsed = JSON.parse(data.json || '{}');
    for (const [k, v] of Object.entries(parsed)) {
      console.log(`    ${k}: ${desc(v)}`);
    }

    // Schema dos users (pra ver todos os campos que existem)
    console.log('\n  SCHEMA DE users[*] (amostra dos campos existentes):');
    const allKeys = new Set();
    Object.values(parsed.users || {}).forEach(u => {
      Object.keys(u || {}).forEach(k => allKeys.add(k));
    });
    [...allKeys].sort().forEach(k => {
      const sample = Object.values(parsed.users || {}).find(u => u && u[k] !== undefined);
      console.log(`    ${k}: ${desc(sample[k])}`);
    });

    // Schema dos bets
    if (Array.isArray(parsed.bets) && parsed.bets.length) {
      console.log('\n  SCHEMA DE bets[0] (amostra):');
      Object.entries(parsed.bets[0]).forEach(([k, v]) => {
        console.log(`    ${k}: ${desc(v)}`);
      });
    }
  } catch (e) {
    console.log('    ERRO parseando json:', e.message);
  }
}

console.log('\n═══ DOC primitivao/state ═══');
const snap2 = await getDoc(doc(db, 'primitivao', 'state'));
if (!snap2.exists()) {
  console.log('  NÃO EXISTE');
} else {
  const data = snap2.data();
  console.log('  CAMPOS TOP-LEVEL:');
  for (const [k, v] of Object.entries(data)) {
    console.log(`    ${k}: ${desc(v)}`);
  }
  try {
    const parsed = JSON.parse(data.json || '{}');
    console.log('\n  CONTEÚDO DO `json` (parseado):');
    for (const [k, v] of Object.entries(parsed)) {
      console.log(`    ${k}: ${desc(v)}`);
    }
  } catch (e) {
    console.log('    ERRO parseando json:', e.message);
  }
}

process.exit(0);
