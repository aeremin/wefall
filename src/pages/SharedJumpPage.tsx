import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { FirebaseError } from 'firebase/app';
import { useCurrentUser } from '../context/AuthContext';
import { canViewJump, subscribeSharedJump } from '../lib/jumps';
import { formatAltitude, formatDate, formatSeconds } from '../lib/format';
import type { SharedJump } from '../lib/types';
import Spinner from '../components/Spinner';

interface State {
  jump: SharedJump | null;
  loading: boolean;
  denied: boolean;
  error: string | null;
}

const LOADING: State = { jump: null, loading: true, denied: false, error: null };

export default function SharedJumpPage() {
  const { ownerUid, jumpId } = useParams() as { ownerUid: string; jumpId: string };
  const user = useCurrentUser();
  const [state, setState] = useState<State>(LOADING);

  useEffect(() => {
    setState(LOADING);
    const viewer = { uid: user.uid, email: user.email };
    return subscribeSharedJump(
      ownerUid,
      jumpId,
      viewer,
      (jump, fromCache) => {
        if (jump && !canViewJump(jump, viewer)) {
          // The offline cache and other tabs can still serve data fetched for a previously signed-in user.
          if (!fromCache) setState({ jump: null, loading: false, denied: true, error: null });
          return;
        }
        setState({ jump, loading: false, denied: !jump && ownerUid !== user.uid, error: null });
      },
      (err) =>
        setState({
          jump: null,
          loading: false,
          denied: err instanceof FirebaseError && err.code === 'permission-denied',
          error: err.message,
        }),
    );
  }, [ownerUid, jumpId, user.uid, user.email]);

  const { jump, loading, denied, error } = state;
  if (loading) return <Spinner />;

  if (!jump) {
    return (
      <div className="card mx-auto max-w-lg space-y-2 py-8 text-center">
        {denied ? (
          <>
            <p className="text-lg font-medium">This jump hasn't been shared with you</p>
            <p className="text-sm text-slate-500">
              You're signed in as <span className="font-medium">{user.email}</span>. Ask the jump's
              owner to add this address as a participant.
            </p>
          </>
        ) : error ? (
          <p className="text-sm text-red-700">Could not load jump: {error}</p>
        ) : (
          <p className="text-lg font-medium">Jump not found</p>
        )}
        <Link to="/shared" className="inline-block text-sm text-sky-700 hover:underline">
          See jumps shared with you
        </Link>
      </div>
    );
  }

  const isOwner = jump.ownerUid === user.uid;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Jump #{jump.jumpNumber}</h1>
          <p className="text-sm text-slate-500">
            {isOwner ? 'Your jump' : `Shared by ${jump.ownerName || 'another jumper'}`}
          </p>
        </div>
        {isOwner && (
          <Link to={`/jumps/${jump.id}`} className="btn btn-secondary">Edit</Link>
        )}
      </div>

      <dl className="card grid gap-4 sm:grid-cols-2">
        <Detail label="Date">{formatDate(jump.date)}</Detail>
        <Detail label="Time">{jump.time || '–'}</Detail>
        <Detail label="Dropzone">{jump.dropzone || '–'}</Detail>
        <Detail label="Aircraft">{jump.aircraft || '–'}</Detail>
        <Detail label="Jump type">{jump.jumpType || '–'}</Detail>
        <Detail label="Canopy">{jump.canopy || '–'}</Detail>
        <Detail label="Exit altitude">{formatAltitude(jump.exitAltitude)}</Detail>
        <Detail label="Deployment altitude">{formatAltitude(jump.deploymentAltitude)}</Detail>
        <Detail label="Freefall time">{formatSeconds(jump.freefallTime)}</Detail>
        {jump.notes && (
          <div className="sm:col-span-2">
            <Detail label="Notes"><span className="whitespace-pre-wrap">{jump.notes}</span></Detail>
          </div>
        )}
      </dl>

      <div className="card">
        <h2 className="mb-2 text-sm font-medium text-slate-700">Participants</h2>
        {jump.participants.length === 0 ? (
          <p className="text-sm text-slate-500">Not shared with anyone.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {jump.participants.map((email) => (
              <li key={email} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                {email}
                {email === user.email?.toLowerCase() && <span className="text-slate-500"> (you)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
