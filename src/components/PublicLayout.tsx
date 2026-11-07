import { Link, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

/** Frame for pages anyone can open without signing in, such as jumps shared by public link. */
export default function PublicLayout() {
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-sky-700">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            WeFall
          </Link>
          {!loading && (
            <Link to={user ? '/' : '/login'} className="ml-auto text-sm text-slate-600 hover:text-slate-900">
              {user ? 'Your logbook' : 'Sign in'}
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
