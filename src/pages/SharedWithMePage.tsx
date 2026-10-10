import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { jumpRef, subscribeJumpsSharedWith } from '../lib/jumps';
import { formatAltitude, formatDate } from '../lib/format';
import type { SharedJump } from '../lib/types';
import Spinner from '../components/Spinner';

interface State {
  jumps: SharedJump[];
  loading: boolean;
  error: string | null;
}

export default function SharedWithMePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ jumps: [], loading: true, error: null });

  useEffect(() => {
    if (!user.email) {
      setState({ jumps: [], loading: false, error: null });
      return;
    }
    return subscribeJumpsSharedWith(
      user.email,
      (jumps) => setState({ jumps, loading: false, error: null }),
      (err) => setState((s) => ({ ...s, loading: false, error: err.message })),
    );
  }, [user.email]);

  const { jumps, loading, error } = state;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Shared with me</h1>
        <p className="text-sm text-slate-500">
          Jumps where other jumpers added <span className="font-medium">{user.email}</span> as a participant
        </p>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {jumps.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-lg font-medium">Nothing shared with you yet</p>
          <p className="mt-1 text-sm text-slate-500">
            When someone adds you as a participant on one of their jumps, it shows up here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Shared by</th>
                <th className="px-4 py-3">Dropzone</th>
                <th className="px-4 py-3">Type</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">Exit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jumps.map((j) => (
                <tr
                  key={`${j.ownerUid}/${j.id}`}
                  className="cursor-pointer hover:bg-sky-50"
                  onClick={() =>
                    navigate(`/shared/${j.ownerUid}/${jumpRef(j, jumps.filter((o) => o.ownerUid === j.ownerUid))}`)
                  }
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(j.date)}
                    {j.time && <span className="ml-2 text-xs text-slate-500">{j.time}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {j.ownerName || '–'}
                    <span className="ml-1 text-xs text-slate-500">#{j.jumpNumber}</span>
                  </td>
                  <td className="px-4 py-3">{j.dropzone || '–'}</td>
                  <td className="px-4 py-3">{j.jumpType || '–'}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">{formatAltitude(j.exitAltitude)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
