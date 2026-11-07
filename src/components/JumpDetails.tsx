import type { ReactNode } from 'react';
import { formatAltitude, formatDate, formatSeconds } from '../lib/format';
import type { Jump } from '../lib/types';

/** A jump's logbook fields, read-only. */
export default function JumpDetails({ jump }: { jump: Jump }) {
  return (
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
