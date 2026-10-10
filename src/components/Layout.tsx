import { NavLink, Outlet } from 'react-router';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useCurrentUser } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Logbook', end: true },
  { to: '/stats', label: 'Stats', end: false },
  { to: '/import', label: 'Import', end: false },
  { to: '/shared', label: 'Shared', end: false },
];

export default function Layout() {
  const user = useCurrentUser();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-bold text-sky-700">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            WeFall
          </NavLink>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">
              {user.displayName ?? user.email}
            </span>
            <button className="text-slate-600 hover:text-slate-900" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
