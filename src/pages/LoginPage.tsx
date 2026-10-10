import { useState } from 'react';
import { Navigate, useLocation, type Location } from 'react-router';
import { signInWithPopup } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, googleProvider } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
};

function errorMessage(err: unknown) {
  if (err instanceof FirebaseError) return ERROR_MESSAGES[err.code] ?? err.message;
  return String(err);
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const from = (useLocation().state as { from?: Location } | null)?.from;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner fullScreen />;
  if (user) return <Navigate to={from ?? '/'} replace />;

  async function signInWithGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-100 to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-2 text-2xl font-bold text-sky-800">WeFall</h1>
          <p className="text-sm text-slate-600">Your skydiving logbook</p>
        </div>

        <div className="card space-y-4 p-6">
          {from?.pathname.startsWith('/shared/') && (
            <p className="text-center text-sm text-slate-600">Sign in to view the jump shared with you.</p>
          )}
          <button className="btn btn-primary w-full" disabled={busy} onClick={signInWithGoogle}>
            Continue with Google
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
