import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { downloadAttachment, fetchAttachmentText } from '../lib/attachments';
import { parseFlySightLog, type LogSample } from '../lib/flysightLog';
import { formatDate } from '../lib/format';
import { subscribePublicJump, subscribeSharedJump } from '../lib/jumps';
import type { SharedJump } from '../lib/types';
import Spinner from '../components/Spinner';
import TrackViewer from '../components/TrackViewer';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A FlySight attachment on the map and in charts. Serves `/jumps/:id/track/:attachmentId` for the
 * user's own jumps, `/shared/:ownerUid/:jumpId/track/:attachmentId` for jumps shared with them and
 * `/link/:token/track/:attachmentId` for jumps shared by public link, which needs no sign-in.
 */
export default function TrackPage() {
  const params = useParams();
  const { user } = useAuth();
  const token = params.token;
  // Only routes behind RequireAuth leave out the token, so there is a user whenever it's needed.
  const ownerUid = params.ownerUid ?? user?.uid ?? '';
  const jumpParam = params.jumpId ?? params.id ?? '';
  const attachmentId = params.attachmentId!;
  const backTo = token
    ? `/link/${token}`
    : params.ownerUid
      ? `/shared/${ownerUid}/${jumpParam}`
      : `/jumps/${jumpParam}`;

  const [jump, setJump] = useState<SharedJump | null | undefined>(undefined);
  const [samples, setSamples] = useState<LogSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJump(undefined);
    if (token) return subscribePublicJump(token, setJump, (err) => setError(err.message));
    return subscribeSharedJump(
      ownerUid,
      jumpParam,
      { uid: user!.uid, email: user!.email },
      (j) => setJump(j),
      (err) => setError(err.message),
    );
  }, [token, ownerUid, jumpParam, user?.uid, user?.email]);

  const attachment = jump?.attachments.find((a) => a.id === attachmentId);

  useEffect(() => {
    if (!jump || !attachment) return;
    let cancelled = false;
    setSamples(null);
    setError(null);
    fetchAttachmentText(jump.ownerUid, jump.id, attachment)
      .then((text) => {
        if (cancelled) return;
        const parsed = parseFlySightLog(text);
        if (parsed.length < 2) setError('This file has no GPS track. FlySight 2 sensor.csv files only hold sensor readings; open the track.csv instead.');
        else setSamples(parsed);
      })
      .catch((err) => !cancelled && setError(message(err)));
    return () => {
      cancelled = true;
    };
    // Refetched only when the attachment itself changes, not on every update to the jump.
  }, [jump?.ownerUid, jump?.id, attachment?.id]);

  if (jump === undefined && !error) return <Spinner />;
  if (!jump || !attachment) {
    return (
      <div className="card mx-auto max-w-lg space-y-2 py-8 text-center">
        <p className="text-lg font-medium">{error ? `Could not load the jump: ${error}` : jump ? 'File not found' : 'Jump not found'}</p>
        <Link to={jump || token ? backTo : '/'} className="inline-block text-sm text-sky-700 hover:underline">
          {jump || token ? 'Back to the jump' : 'Back to logbook'}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">
            Jump #{jump.jumpNumber} <span className="font-normal text-slate-500">· {formatDate(jump.date)}</span>
          </h1>
          <p className="truncate text-sm text-slate-500">
            {attachment.name}
            {jump.dropzone && ` · ${jump.dropzone}`}
            {jump.ownerUid !== user?.uid && ` · shared by ${jump.ownerName || 'another jumper'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => downloadAttachment(jump.ownerUid, jump.id, attachment).catch((err) => setError(message(err)))}
          >
            Download
          </button>
          <Link to={backTo} className="btn btn-secondary">Back to jump</Link>
        </div>
      </div>
      {error ? (
        <p className="card text-sm text-red-700">{error}</p>
      ) : samples ? (
        <TrackViewer
          key={attachment.id}
          samples={samples}
          logbookTime={jump.time ? new Date(`${jump.date}T${jump.time}`).getTime() : null}
        />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
