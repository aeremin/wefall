import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useJumps } from '../context/JumpsContext';
import { downloadCsv, jumpsToCsv } from '../lib/csv';
import { formatAltitude, formatDate, formatSeconds, todayIso } from '../lib/format';
import Spinner from '../components/Spinner';

export default function JumpsPage() {
  const { jumps, loading, error } = useJumps();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jumps;
    return jumps.filter((j) =>
      [String(j.jumpNumber), j.date, j.dropzone, j.aircraft, j.jumpType, j.canopy, j.notes]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [jumps, search]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Logbook</h1>
          <p className="text-sm text-slate-500">
            {jumps.length} {jumps.length === 1 ? 'jump' : 'jumps'}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {jumps.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => downloadCsv(`wefall-${todayIso()}.csv`, jumpsToCsv(jumps))}
            >
              Export CSV
            </button>
          )}
          <Link to="/jumps/new" className="btn btn-primary">+ Log jump</Link>
        </div>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {jumps.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-lg font-medium">No jumps logged yet</p>
          <p className="mt-1 text-sm text-slate-500">
            <Link to="/jumps/new" className="text-sky-700 hover:underline">Log your first jump</Link>
            {' '}or{' '}
            <Link to="/import" className="text-sky-700 hover:underline">import from CSV</Link>.
          </p>
        </div>
      ) : (
        <>
          <input
            className="input max-w-sm"
            placeholder="Search dropzone, aircraft, type, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Dropzone</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="hidden px-4 py-3 md:table-cell">Aircraft</th>
                  <th className="px-4 py-3 text-right">Exit</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Freefall</th>
                  <th className="hidden px-4 py-3 md:table-cell">Canopy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((j) => (
                  <tr
                    key={j.id}
                    className="cursor-pointer hover:bg-sky-50"
                    onClick={() => navigate(`/jumps/${j.id}`)}
                  >
                    <td className="px-4 py-3 font-semibold">{j.jumpNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDate(j.date)}
                      {j.time && <span className="ml-2 text-xs text-slate-500">{j.time}</span>}
                    </td>
                    <td className="px-4 py-3">{j.dropzone || '–'}</td>
                    <td className="px-4 py-3">{j.jumpType || '–'}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{j.aircraft || '–'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatAltitude(j.exitAltitude)}</td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell">{formatSeconds(j.freefallTime)}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{j.canopy || '–'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      No jumps match "{search}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
