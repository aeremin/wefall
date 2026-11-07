import {setGlobalOptions} from "firebase-functions";
import {
  onDocumentDeleted,
  onDocumentWritten,
} from "firebase-functions/firestore";
import {HttpsError, onCall} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
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

/**
 * Roles kept in users' `roles` custom claim. Keep in sync with
 * src/lib/roles.ts and scripts/set-roles.mjs.
 */
const ROLES = ["admin", "beta"] as const;
type Role = typeof ROLES[number];

const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

/**
 * Finds the user by the `email` in a callable's data.
 * @param {unknown} data The callable's data.
 * @return {Promise<UserRecord>} The user.
 */
async function userByEmail(data: unknown) {
  const email = (data as {email?: unknown} | null)?.email;
  if (typeof email !== "string" || !email.trim()) {
    throw new HttpsError("invalid-argument", "Give the user's email.");
  }
  try {
    return await getAuth().getUserByEmail(email.trim());
  } catch (e) {
    if ((e as {code?: string}).code === "auth/user-not-found") {
      throw new HttpsError("not-found", `No user signed up as ${email}.`);
    }
    throw e;
  }
}

/**
 * Only admins (see scripts/set-roles.mjs for the first one) may manage roles.
 * @param {object | undefined} auth The callable's auth context.
 */
function requireAdmin(auth: {token: Record<string, unknown>} | undefined) {
  const roles = auth?.token.roles;
  if (!Array.isArray(roles) || !roles.includes("admin")) {
    throw new HttpsError("permission-denied", "Only admins can manage roles.");
  }
}

const rolesOf = (claims: Record<string, unknown> | undefined): Role[] =>
  Array.isArray(claims?.roles) ? claims.roles.filter(isRole) : [];

/** Returns the roles of the user with the given `email`. */
export const getUserRoles = onCall(async (request) => {
  requireAdmin(request.auth);
  const user = await userByEmail(request.data);
  return {uid: user.uid, email: user.email, roles: rolesOf(user.customClaims)};
});

/**
 * Sets the roles of the user with the given `email`. They apply once the
 * user's ID token is refreshed: within an hour, or on their next sign-in.
 */
export const setUserRoles = onCall(async (request) => {
  requireAdmin(request.auth);
  const raw = (request.data as {roles?: unknown} | null)?.roles;
  if (!Array.isArray(raw) || !raw.every(isRole)) {
    throw new HttpsError(
      "invalid-argument", `Roles must be a list of: ${ROLES.join(", ")}.`,
    );
  }
  const roles = [...new Set(raw)];
  const user = await userByEmail(request.data);
  if (user.uid === request.auth?.uid && !roles.includes("admin")) {
    throw new HttpsError(
      "failed-precondition", "You can't remove your own admin role.",
    );
  }
  await getAuth().setCustomUserClaims(user.uid, {...user.customClaims, roles});
  logger.info("Set user roles", {
    uid: user.uid, roles, by: request.auth?.uid,
  });
  return {uid: user.uid, email: user.email, roles};
});
