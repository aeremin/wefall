#!/usr/bin/env node
/**
 * Shows or sets a user's roles (the `roles` custom claim) with the Admin SDK, e.g. to make the
 * first admin, who can then manage roles on the site's Admin page.
 *
 *   cd functions
 *   node scripts/set-roles.mjs someone@example.com             # show their roles
 *   node scripts/set-roles.mjs someone@example.com admin beta  # replace them
 *   node scripts/set-roles.mjs someone@example.com --none      # remove all roles
 *
 * Needs Application Default Credentials for the project: `gcloud auth application-default login`,
 * or GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key.
 */
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";

/** Keep in sync with ROLES in src/index.ts. */
const ROLES = ["admin", "beta"];

const [email, ...args] = process.argv.slice(2);
if (!email) {
  console.error("Usage: node scripts/set-roles.mjs <email> [role... | --none]");
  process.exit(1);
}
const unknown = args.filter((r) => r !== "--none" && !ROLES.includes(r));
if (unknown.length) {
  console.error(`Unknown roles: ${unknown.join(", ")}. Known roles: ${ROLES.join(", ")}.`);
  process.exit(1);
}

initializeApp({projectId: process.env.GCLOUD_PROJECT ?? "wefall"});
const auth = getAuth();
const user = await auth.getUserByEmail(email);
if (args.length) {
  const roles = [...new Set(args.filter((r) => r !== "--none"))];
  await auth.setCustomUserClaims(user.uid, {...user.customClaims, roles});
  console.log(`${email} (${user.uid}) now has roles: ${roles.join(", ") || "none"}.`);
  console.log("They apply when the user's ID token refreshes: within an hour, or on next sign-in.");
} else {
  const roles = user.customClaims?.roles ?? [];
  console.log(`${email} (${user.uid}) has roles: ${roles.join(", ") || "none"}.`);
}
