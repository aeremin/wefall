import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import { getUserRoles, ROLE_DESCRIPTIONS, ROLES, setUserRoles, type Role, type UserRoles } from '../lib/roles';

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Lets admins look up a user by email and set their roles. */
export default function AdminPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<UserRoles | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setFound(null);
    try {
      const { data } = await getUserRoles({ email: email.trim() });
      setFound(data);
      setRoles(data.roles);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!found) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await setUserRoles({ email: found.email, roles });
      setFound(data);
      setRoles(data.roles);
      if (data.uid === user?.uid) {
        await auth.currentUser?.getIdToken(true); // Apply to this session right away.
        setMessage('Saved.');
      } else {
        setMessage('Saved. They get the new roles within an hour, or when they next sign in.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const changed = found && [...roles].sort().join() !== [...found.roles].sort().join();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-slate-500">Give users roles that show tools hidden from everyone else</p>
      </div>

      <form className="card flex flex-wrap items-end gap-3" onSubmit={lookUp}>
        <div className="min-w-0 flex-1">
          <label htmlFor="email" className="label">
            User's email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@example.com"
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy || !email.trim()}>
          Look up
        </button>
      </form>

      {error && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {found && (
        <div className="card space-y-3">
          <p className="text-sm">
            Roles of <span className="font-medium">{found.email}</span>
          </p>
          {ROLES.map((role) => (
            <label key={role} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={roles.includes(role)}
                disabled={busy || (role === 'admin' && found.uid === user?.uid)}
                onChange={(e) =>
                  setRoles((rs) => (e.target.checked ? [...rs, role] : rs.filter((r) => r !== role)))
                }
              />
              <span>
                <span className="font-medium">{role}</span>
                <span className="block text-slate-500">{ROLE_DESCRIPTIONS[role]}</span>
              </span>
            </label>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={save}>
              Save
            </button>
            {message && <span className="text-sm text-slate-500">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
