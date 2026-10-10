import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Jump, JumpInput, JumpSharing, SharedJump } from './types';

const jumpsCollection = (uid: string) => collection(db, 'users', uid, 'jumps');

function toJump(d: DocumentSnapshot): Jump {
  return {
    ...(d.data() as JumpInput),
    time: d.get('time') ?? '',
    participants: d.get('participants') ?? [],
    id: d.id,
  };
}

function toSharedJump(d: DocumentSnapshot): SharedJump {
  return { ...toJump(d), ownerUid: d.ref.parent.parent!.id, ownerName: d.get('ownerName') ?? '' };
}

export function subscribeJumps(
  uid: string,
  onData: (jumps: Jump[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(jumpsCollection(uid), orderBy('jumpNumber', 'desc'));
  return onSnapshot(q, (snap) => onData(snap.docs.map(toJump)), onError);
}

/** Resolves to null when the jump doesn't exist (or is hidden by the offline cache). */
export function subscribeSharedJump(
  ownerUid: string,
  jumpId: string,
  onData: (jump: SharedJump | null) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    doc(jumpsCollection(ownerUid), jumpId),
    (d) => onData(d.exists() ? toSharedJump(d) : null),
    onError,
  );
}

/** Jumps from any user's logbook that list `email` as a participant, newest first. */
export function subscribeJumpsSharedWith(
  email: string,
  onData: (jumps: SharedJump[]) => void,
  onError: (error: Error) => void,
) {
  // Sorted client-side: ordering in the query would need a composite collection-group index.
  const q = query(collectionGroup(db, 'jumps'), where('participants', 'array-contains', normalizeEmail(email)));
  return onSnapshot(
    q,
    (snap) =>
      onData(
        snap.docs
          .map(toSharedJump)
          .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)),
      ),
    onError,
  );
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function sharedJumpUrl(ownerUid: string, jumpId: string) {
  return `${window.location.origin}/shared/${ownerUid}/${jumpId}`;
}

export function addJump(uid: string, jump: JumpInput & Partial<JumpSharing>) {
  return setDoc(doc(jumpsCollection(uid)), {
    ...jump,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function updateJump(uid: string, id: string, jump: JumpInput & Partial<JumpSharing>) {
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
