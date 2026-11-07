import {setGlobalOptions} from "firebase-functions";
import {
  onDocumentDeleted,
  onDocumentWritten,
} from "firebase-functions/firestore";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {getStorage} from "firebase-admin/storage";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

initializeApp();

// Firestore triggers must run in the database's location (see firebase.json).
setGlobalOptions({maxInstances: 10, region: "europe-west6"});

/** Deletes a jump's attachments from Cloud Storage once the jump is deleted. */
export const deleteJumpAttachments = onDocumentDeleted(
  "users/{uid}/jumps/{jumpId}",
  async (event) => {
    const {uid, jumpId} = event.params;
    const prefix = `users/${uid}/jumps/${jumpId}/`;
    await getStorage().bucket().deleteFiles({prefix});
    logger.info("Deleted jump attachments", {prefix});
  },
);

/** Keep in sync with the linkToken check in firestore.rules. */
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** Jump fields shown on its public page; participants' emails stay private. */
const PUBLIC_FIELDS = [
  "jumpNumber", "date", "time", "dropzone", "aircraft", "jumpType",
  "exitAltitude", "deploymentAltitude", "freefallTime", "canopy", "notes",
  "ownerName", "attachments",
];

const linkToken = (data: FirebaseFirestore.DocumentData | undefined) =>
  typeof data?.linkToken === "string" && LINK_TOKEN_RE.test(data.linkToken) ?
    data.linkToken as string :
    null;

/**
 * Mirrors a jump shared by public link to `publicJumps/{linkToken}`, which
 * anyone with the link can read, and removes the copy when the link is turned
 * off or replaced or the jump is deleted. Works from the jump as it is now
 * rather than from the event, so events handled out of order can't bring back
 * a link that was turned off.
 */
export const syncPublicJump = onDocumentWritten(
  "users/{uid}/jumps/{jumpId}",
  async (event) => {
    const {uid, jumpId} = event.params;
    const eventTokens = [
      linkToken(event.data?.before.data()),
      linkToken(event.data?.after.data()),
    ];
    // Most jumps are never shared by link.
    if (eventTokens.every((t) => t == null)) return;
    const db = getFirestore();
    const jumpRef = db.doc(`users/${uid}/jumps/${jumpId}`);
    await db.runTransaction(async (tx) => {
      const jump = (await tx.get(jumpRef)).data();
      const current = linkToken(jump);
      const stale = eventTokens.filter(
        (t): t is string => t != null && t !== current,
      );
      for (const token of new Set(stale)) {
        tx.delete(db.doc(`publicJumps/${token}`));
      }
      if (jump && current) {
        const copy: Record<string, unknown> = {
          ownerUid: uid,
          jumpId,
          updatedAt: FieldValue.serverTimestamp(),
        };
        for (const field of PUBLIC_FIELDS) {
          if (field in jump) copy[field] = jump[field];
        }
        tx.set(db.doc(`publicJumps/${current}`), copy);
      }
    });
  },
);
