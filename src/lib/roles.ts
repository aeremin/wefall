import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

/**
 * Roles kept in users' `roles` custom claim, set by admins on the Admin page or with
 * functions/scripts/set-roles.mjs. Keep in sync with ROLES in functions/src/index.ts.
 */
export const ROLES = ['admin', 'beta'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Manages roles and sees everything beta testers see',
  beta: 'Sees unfinished and debugging tools, such as the Bluetooth explorer',
};

export function parseRoles(claim: unknown): Role[] {
  return Array.isArray(claim) ? claim.filter((r): r is Role => (ROLES as readonly unknown[]).includes(r)) : [];
}

/** Whether a user with `roles` may see something limited to `allowed`. Admins see everything. */
export function hasAnyRole(roles: readonly Role[], allowed: readonly Role[] | undefined): boolean {
  return !allowed || roles.includes('admin') || allowed.some((r) => roles.includes(r));
}

export interface UserRoles {
  uid: string;
  email: string;
  roles: Role[];
}

// Same region as the functions (setGlobalOptions in functions/src/index.ts).
const functions = getFunctions(app, 'europe-west6');
export const getUserRoles = httpsCallable<{ email: string }, UserRoles>(functions, 'getUserRoles');
export const setUserRoles = httpsCallable<{ email: string; roles: Role[] }, UserRoles>(
  functions,
  'setUserRoles',
);
