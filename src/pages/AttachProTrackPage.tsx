import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import { addAttachments } from '../lib/attachments';
import { isProTrackFile, parseProTrackFile, type ProTrackJump } from '../lib/protrack';
import { jumpRef } from '../lib/jumps';
import { formatAltitude, formatDate, formatSeconds } from '../lib/format';
import type { Jump } from '../lib/types';

/** How far the logbook may disagree with the ProTrack recording and still be the same jump. */
const TIME_TOLERANCE_MIN = 15;
const ALTITUDE_TOLERANCE_M = 150;
const FREEFALL_TOLERANCE_S = 5;
const UPLOAD_CONCURRENCY = 4;

type Status =
  /** Jump with the file's number agrees with the recording. */
  | 'match'
  /** Same date, but nothing else to tell it apart from other jumps that day. */
  | 'unverified'
  /** Jump with the file's number disagrees, and another jump that day fits. */
  | 'renumbered'
  | 'mismatch'
  | 'missing'
  | 'attached'
  | 'error';

interface Row {
  file: File;
  data?: ProTrackJump;
  error?: string;
  status: Status;
  /** Jump to attach the file to. */
  target?: Jump;
  /** Logged jump with the file's number, for comparison. */
  logged?: Jump;
  reason: string;
}

const STATUS_LABELS: Record<Status, string> = {
  match: 'Match',
  unverified: 'Date only',
  renumbered: 'Renumbered',
  mismatch: 'Mismatch',
  missing: 'No such jump',
  attached: 'Already attached',
  error: 'Error',
};

const STATUS_CLASSES: Record<Status, string> = {
  match: 'bg-green-50 text-green-700',
  unverified: 'bg-amber-50 text-amber-700',
  renumbered: 'bg-sky-50 text-sky-700',
  mismatch: 'bg-red-50 text-red-700',
  missing: 'bg-slate-100 text-slate-600',
  attached: 'bg-slate-100 text-slate-600',
  error: 'bg-red-50 text-red-700',
};

/** Selected by default; the others can be ticked by hand. */
const AUTO_SELECT: Status[] = ['match'];
const SELECTABLE: Status[] = ['match', 'unverified', 'renumbered'];

const minutes = (time: string) => {
  const [h, m, s] = time.split(':').map(Number);
  return h * 60 + m + s / 60;
};

/** Ways the logged jump contradicts the recording, and whether anything besides the date agrees. */
function compare(jump: Jump, data: ProTrackJump) {
  const conflicts: string[] = [];
  let corroborated = false;
  if (jump.date !== data.date) {
    return { conflicts: [`logged on ${formatDate(jump.date)}, recorded ${formatDate(data.date)}`], corroborated };
  }
  if (jump.time && data.time) {
    const diff = Math.abs(minutes(jump.time) - minutes(data.time));
    if (diff > TIME_TOLERANCE_MIN) conflicts.push(`logged at ${jump.time.slice(0, 5)}, recorded ${data.time.slice(0, 5)}`);
    else corroborated = true;
  }
  const numeric = [
    ['exit', jump.exitAltitude, data.exitAltitude, ALTITUDE_TOLERANCE_M, formatAltitude],
    ['deployment', jump.deploymentAltitude, data.deploymentAltitude, ALTITUDE_TOLERANCE_M, formatAltitude],
    ['freefall', jump.freefallTime, data.freefallTime, FREEFALL_TOLERANCE_S, formatSeconds],
  ] as const;
  for (const [label, logged, recorded, tolerance, format] of numeric) {
    // ProTrack writes 0 when it couldn't detect a value.
    if (logged == null || !recorded) continue;
    if (Math.abs(logged - recorded) > tolerance) conflicts.push(`${label} ${format(logged)} logged, ${format(recorded)} recorded`);
    else corroborated = true;
  }
  return { conflicts, corroborated };
}

const hasProTrack = (jump: Jump, file: File) =>
  jump.attachments.some((a) => a.type === 'protrack' || a.name === file.name);

function matchFile(file: File, data: ProTrackJump, jumps: Jump[]): Omit<Row, 'file' | 'data'> {
  const logged = jumps.find((j) => j.jumpNumber === data.jumpNumber);
  const sameDay = jumps.filter((j) => j.date === data.date);
  // Another jump that day that agrees on more than the date, and is the only one that does.
  const fits = sameDay.filter((j) => {
    if (j === logged) return false;
    const { conflicts, corroborated } = compare(j, data);
    return conflicts.length === 0 && corroborated;
  });
  const alternative = fits.length === 1 ? fits[0] : undefined;
  const suggest = (status: Status, reason: string): Omit<Row, 'file' | 'data'> =>
    alternative && !hasProTrack(alternative, file)
      ? { status: 'renumbered', target: alternative, logged, reason: `${reason}; looks like #${alternative.jumpNumber}` }
      : { status, logged, reason };

  if (!logged) return suggest('missing', `No jump #${data.jumpNumber} in the logbook`);
  if (hasProTrack(logged, file)) return { status: 'attached', logged, reason: 'Jump already has a ProTrack file' };

  const { conflicts, corroborated } = compare(logged, data);
  if (conflicts.length > 0) return suggest('mismatch', conflicts.join('; '));
  if (corroborated) return { status: 'match', target: logged, logged, reason: 'Date, time or altitudes agree' };
  if (sameDay.length === 1) return { status: 'match', target: logged, logged, reason: 'Only jump on that date' };
  return {
    status: 'unverified',
    target: logged,
    logged,
    reason: `${sameDay.length} jumps on that date and nothing else to compare`,
  };
}

async function readFile(file: File): Promise<Pick<Row, 'file' | 'data' | 'error'> | null> {
  const text = await file.text();
  if (!isProTrackFile(text)) return null;
  try {
    return { file, data: parseProTrackFile(text) };
  } catch (err) {
    return { file, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Bulk-attaches ProTrack files to logged jumps, checking that each file really belongs to its jump. */
export default function AttachProTrackPage() {
  const user = useCurrentUser();
  const { jumps, loading } = useJumps();

  const [files, setFiles] = useState<Pick<Row, 'file' | 'data' | 'error'>[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [overrides, setOverrides] = useState<Map<File, boolean>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [finished, setFinished] = useState<number | null>(null);

  const rows = useMemo(
    (): Row[] =>
      files.map((f) =>
        f.data
          ? { ...f, ...matchFile(f.file, f.data, jumps) }
          : { ...f, status: 'error', reason: f.error ?? 'Unreadable file' },
      ),
    [files, jumps],
  );

  const isSelected = (r: Row) =>
    SELECTABLE.includes(r.status) && (overrides.get(r.file) ?? AUTO_SELECT.includes(r.status));

  // Two files must never land on the same jump; the first one (by recorded jump number) wins.
  const selected = useMemo(() => {
    const taken = new Set<string>();
    return rows.filter((r) => {
      if (!isSelected(r) || taken.has(r.target!.id)) return false;
      taken.add(r.target!.id);
      return true;
    });
  }, [rows, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = new Map<Status, number>();
    for (const r of rows) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows]);

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.txt'));
    const read = (await Promise.all(picked.map(readFile))).filter((r) => r != null);
    read.sort((a, b) => (a.data?.jumpNumber ?? Infinity) - (b.data?.jumpNumber ?? Infinity));
    setFiles(read);
    setIgnored((e.target.files?.length ?? 0) - read.length);
    setOverrides(new Map());
    setFailures([]);
    setFinished(null);
  }

  async function handleUpload() {
    const queue = [...selected];
    const total = queue.length;
    let done = 0;
    const failed: string[] = [];
    setFailures([]);
    setProgress({ done, total });
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        try {
          await addAttachments(user.uid, r.target!, [r.file]);
        } catch (err) {
          failed.push(`${r.file.name} → #${r.target!.jumpNumber}: ${err instanceof Error ? err.message : String(err)}`);
        }
        setProgress({ done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    setProgress(null);
    setFailures(failed);
    setFinished(total - failed.length);
  }

  const toggle = (r: Row) => setOverrides((m) => new Map(m).set(r.file, !isSelected(r)));
  const uploading = progress != null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Attach ProTrack files</h1>
        <p className="text-sm text-slate-500">
          Select a folder of ProTrack jump files (or many files at once) to attach them to jumps already
          in the logbook. ProTrack's jump counter can drift from the logbook, so each file is checked
          against the logged jump's date, time and altitudes. Only matching files are selected; the rest
          are skipped unless ticked by hand. <Link to="/import" className="text-sky-700 hover:underline">Back to import</Link>
        </p>
      </div>

      <div className="card flex flex-wrap gap-3">
        {/* @ts-expect-error webkitdirectory isn't in React's typings */}
        <input type="file" webkitdirectory="" onChange={handleFiles} disabled={uploading || loading} id="pt-folder" className="hidden" />
        <label htmlFor="pt-folder" className="btn btn-secondary cursor-pointer">Choose folder…</label>
        <input type="file" multiple accept=".txt,text/plain" onChange={handleFiles} disabled={uploading || loading} id="pt-files" className="hidden" />
        <label htmlFor="pt-files" className="btn btn-secondary cursor-pointer">Choose files…</label>
        {files.length > 0 && (
          <p className="self-center text-sm text-slate-500">
            {files.length} ProTrack files{ignored > 0 && `, ${ignored} other files ignored`}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {[...counts].map(([status, n]) => (
              <span key={status} className={`rounded px-2 py-0.5 font-medium ${STATUS_CLASSES[status]}`}>
                {STATUS_LABELS[status]}: {n}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={uploading || selected.length === 0} onClick={handleUpload}>
              {uploading ? `Uploading… ${progress.done} / ${progress.total}` : `Attach ${selected.length} files`}
            </button>
            {finished != null && <span className="text-sm text-green-700">Attached {finished} files.</span>}
          </div>

          {failures.length > 0 && (
            <ul className="max-h-32 overflow-y-auto text-xs text-red-600">
              {failures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}

          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b bg-white text-slate-500">
                <tr>
                  <th className="py-1 pr-2"></th>
                  <th className="py-1 pr-3">File</th>
                  <th className="py-1 pr-3">Recorded</th>
                  <th className="py-1 pr-3">Logged #</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Attach to</th>
                  <th className="py-1 pr-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.file.webkitRelativePath || r.file.name} className="border-b border-slate-100 align-top">
                    <td className="py-1 pr-2">
                      {SELECTABLE.includes(r.status) && (
                        <input type="checkbox" checked={selected.includes(r)} disabled={uploading} onChange={() => toggle(r)} />
                      )}
                    </td>
                    <td className="py-1 pr-3 font-medium">{r.file.name}</td>
                    <td className="whitespace-nowrap py-1 pr-3">
                      {r.data && <>#{r.data.jumpNumber} · {formatDate(r.data.date)} {r.data.time.slice(0, 5)}</>}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-3">
                      {r.logged && <>{formatDate(r.logged.date)} {r.logged.time.slice(0, 5)}</>}
                    </td>
                    <td className="py-1 pr-3">
                      <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_CLASSES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="py-1 pr-3">
                      {r.target && (
                        <Link to={`/jumps/${jumpRef(r.target, jumps)}`} className="text-sky-700 hover:underline">
                          #{r.target.jumpNumber}
                        </Link>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-slate-500">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
