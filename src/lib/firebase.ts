import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyD-ogo4QlCC-cT57SPTaA0Qo2LE7Xqg6_I',
  authDomain: 'wefall.firebaseapp.com',
  projectId: 'wefall',
  storageBucket: 'wefall.firebasestorage.app',
  messagingSenderId: '427384930810',
  appId: '1:427384930810:web:0bc3b6ee8a86388cb32443',
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Offline cache so jumps can be logged at dropzones with poor reception.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
