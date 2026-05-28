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
const data = snap.data();
const json = JSON.parse(data.json || '{}');
console.log('teamPlayers:', JSON.stringify(json.teamPlayers || {}, null, 2));
console.log('users:', Object.keys(json.users || {}).join(', '));
process.exit(0);
