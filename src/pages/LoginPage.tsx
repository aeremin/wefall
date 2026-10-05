import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, googleProvider } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

type Mode = 'signin' | 'signup' | 'reset';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
};

function errorMessage(err: unknown) {
  if (err instanceof FirebaseError) return ERROR_MESSAGES[err.code] ?? err.message;
  return String(err);
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner fullScreen />;
  if (user) return <Navigate to="/" replace />;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        await sendPasswordResetEmail(auth, email);
        setInfo('Password reset email sent. Check your inbox.');
      }
    });
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-100 to-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-2 text-2xl font-bold text-sky-800">WeFall</h1>
          <p className="text-sm text-slate-600">Your skydiving logbook</p>
        </div>

        <div className="card space-y-4 p-6">
          {mode !== 'reset' && (
            <>
              <button
                className="btn btn-secondary w-full"
                disabled={busy}
                onClick={() => run(() => signInWithPopup(auth, googleProvider))}
              >
                Continue with Google
              </button>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                or
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          )}

          <form className="space-y-3" onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            {mode !== 'reset' && (
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-green-700">{info}</p>}

            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
          </form>

          <div className="flex justify-between text-sm">
            {mode === 'signin' ? (
              <>
                <button className="text-sky-700 hover:underline" onClick={() => switchMode('signup')}>Create account</button>
                <button className="text-slate-500 hover:underline" onClick={() => switchMode('reset')}>Forgot password?</button>
              </>
            ) : (
              <button className="text-sky-700 hover:underline" onClick={() => switchMode('signin')}>Back to sign in</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
