import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type FirestoreError,
  type Unsubscribe,
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

const PERMISSION_RETRY_DELAYS_MS = [1000, 2000];

/**
 * With multi-tab persistence, a listener started right after a sign-in may be executed by another
 * tab that still holds the previous user's credentials, so permission errors are retried briefly.
 */
function listenWithRetry(
  listen: (onError: (error: FirestoreError) => void) => Unsubscribe,
  onError: (error: Error) => void,
): Unsubscribe {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: Unsubscribe = () => {};
  const start = () => {
    unsubscribe = listen((error) => {
      if (error.code === 'permission-denied' && attempt < PERMISSION_RETRY_DELAYS_MS.length) {
        timer = setTimeout(start, PERMISSION_RETRY_DELAYS_MS[attempt++]);
      } else {
        onError(error);
      }
    });
  };
  start();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

export function subscribeJumps(
  uid: string,
  onData: (jumps: Jump[]) => void,
  onError: (error: Error) => void,
) {
  const q = query(jumpsCollection(uid), orderBy('jumpNumber', 'desc'));
  return listenWithRetry((handleError) => onSnapshot(q, (snap) => onData(snap.docs.map(toJump)), handleError), onError);
}

/** Jump links accept either a document id or a jump number; auto-generated ids are never all digits in practice. */
export function parseJumpNumber(param: string): number | null {
  return /^[1-9][0-9]{0,8}$/.test(param) ? Number(param) : null;
}

/**
 * `jumpRef` is a document id or a jump number (see `parseJumpNumber`).
 * Emits null when the jump doesn't exist or, for a jump number, isn't shared with the viewer.
 */
export function subscribeSharedJump(
  ownerUid: string,
  jumpRef: string,
  viewer: { uid: string; email: string | null },
  onData: (jump: SharedJump | null, fromCache: boolean) => void,
  onError: (error: Error) => void,
) {
  const jumpNumber = parseJumpNumber(jumpRef);
  if (jumpNumber == null) {
    return listenWithRetry(
      (handleError) =>
        onSnapshot(
          doc(jumpsCollection(ownerUid), jumpRef),
          (d) => onData(d.exists() ? toSharedJump(d) : null, d.metadata.fromCache),
          handleError,
        ),
      onError,
    );
  }
  const filters = [where('jumpNumber', '==', jumpNumber)];
  // Queries by non-owners are only allowed when restricted to jumps the rules let them read.
  if (viewer.uid !== ownerUid) {
    filters.push(where('participants', 'array-contains', normalizeEmail(viewer.email ?? '')));
  }
  const q = query(jumpsCollection(ownerUid), ...filters, limit(1));
  return listenWithRetry(
    (handleError) =>
      onSnapshot(
        q,
        (snap) => onData(snap.empty ? null : toSharedJump(snap.docs[0]), snap.metadata.fromCache),
        handleError,
      ),
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
  return listenWithRetry(
    (handleError) =>
      onSnapshot(
        q,
        (snap) =>
          onData(
            snap.docs
              .map(toSharedJump)
              .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)),
          ),
        handleError,
      ),
    onError,
  );
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Mirrors the read rules in firestore.rules. */
export function canViewJump(jump: SharedJump, viewer: { uid: string; email: string | null }) {
  return jump.ownerUid === viewer.uid || (!!viewer.email && jump.participants.includes(normalizeEmail(viewer.email)));
}

/**
 * The path segment that identifies `jump` in links: its jump number, or its id when another jump
 * among `others` (the jumps the link's viewer can see from the same owner) shares that number.
 */
export function jumpRef(jump: Jump, others: Jump[]) {
  return others.some((j) => j.jumpNumber === jump.jumpNumber && j.id !== jump.id) ? jump.id : String(jump.jumpNumber);
}

export function sharedJumpUrl(ownerUid: string, jumpRef: string) {
  return `${window.location.origin}/shared/${ownerUid}/${jumpRef}`;
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
