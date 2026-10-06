import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Jump, JumpInput } from './types';

const jumpsCollection = (uid: string) => collection(db, 'users', uid, 'jumps');

export function subscribeJumps(
  uid: string,
  onData: (jumps: Jump[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(jumpsCollection(uid), orderBy('jumpNumber', 'desc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as JumpInput), time: d.get('time') ?? '', id: d.id }))),
    onError,
  );
}

export function addJump(uid: string, jump: JumpInput) {
  return setDoc(doc(jumpsCollection(uid)), {
    ...jump,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function updateJump(uid: string, id: string, jump: JumpInput) {
  return updateDoc(doc(jumpsCollection(uid), id), { ...jump, updatedAt: serverTimestamp() });
}

export function deleteJump(uid: string, id: string) {
  return deleteDoc(doc(jumpsCollection(uid), id));
}

const BATCH_SIZE = 400;

export async function importJumps(
  uid: string,
  jumps: JumpInput[],
  onProgress?: (done: number) => void,
) {
  for (let i = 0; i < jumps.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const jump of jumps.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(jumpsCollection(uid)), {
        ...jump,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    onProgress?.(Math.min(i + BATCH_SIZE, jumps.length));
  }
}

/** Jumps with an `id` overwrite that existing document; the rest are created. */
export async function reimportJumps(
  uid: string,
  jumps: (JumpInput & { id?: string })[],
  onProgress?: (done: number) => void,
) {
  for (let i = 0; i < jumps.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const { id, ...jump } of jumps.slice(i, i + BATCH_SIZE)) {
      if (id) {
        batch.update(doc(jumpsCollection(uid), id), { ...jump, updatedAt: serverTimestamp() });
      } else {
        batch.set(doc(jumpsCollection(uid)), {
          ...jump,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
    onProgress?.(Math.min(i + BATCH_SIZE, jumps.length));
  }
}
