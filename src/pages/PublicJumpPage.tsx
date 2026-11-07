import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { subscribePublicJump } from '../lib/jumps';
import type { SharedJump } from '../lib/types';
import Spinner from '../components/Spinner';
import Attachments from '../components/Attachments';
import JumpDetails from '../components/JumpDetails';

/** A jump opened through its public link (`/link/:token`); needs no sign-in. */
export default function PublicJumpPage() {
  const { token } = useParams() as { token: string };
  const { user } = useAuth();
  const [jump, setJump] = useState<SharedJump | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJump(undefined);
    setError(null);
    return subscribePublicJump(token, setJump, (err) => setError(err.message));
  }, [token]);

  if (jump === undefined && !error) return <Spinner />;

  if (!jump) {
    return (
      <div className="card mx-auto max-w-lg space-y-2 py-8 text-center">
        {error ? (
          <p className="text-sm text-red-700">Could not load the jump: {error}</p>
        ) : (
          <>
            <p className="text-lg font-medium">This link doesn't lead to a jump</p>
            <p className="text-sm text-slate-500">
              Its owner may have stopped sharing it, or the link is incomplete. A link that was created a
              moment ago can take a few seconds to start working.
            </p>
          </>
        )}
      </div>
    );
  }

  const isOwner = jump.ownerUid === user?.uid;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Jump #{jump.jumpNumber}</h1>
          <p className="text-sm text-slate-500">
            {isOwner ? 'Your jump, as anyone with the link sees it' : `Shared by ${jump.ownerName || 'a WeFall jumper'}`}
          </p>
        </div>
        {isOwner && (
          <Link to={`/jumps/${jump.id}`} className="btn btn-secondary">Edit</Link>
        )}
      </div>

      <JumpDetails jump={jump} />

      <Attachments ownerUid={jump.ownerUid} jump={jump} editable={false} />
    </div>
  );
}
