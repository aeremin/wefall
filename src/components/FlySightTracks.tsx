import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import { attachFiles } from '../lib/attachments';
import type { FlySightFile } from '../lib/flysightBle';
import { formatAltitude, formatBytes, formatDate } from '../lib/format';
import {
  SENSOR_FILE,
  TRACK_FILE,
  attachmentName,
  detectJumps,
  findFile,
  listSessions,
  localDateTime,
  matchJumps,
  parseTrack,
  type DetectedJump,
  type FlySightFileSource,
  type FlySightSession,
  type MatchKind,
} from '../lib/flysightTracks';
import { MAX_ATTACHMENT_BYTES, type Jump } from '../lib/types';

interface ScannedSession {
  files: FlySightFile[];
  /** track.csv's text, kept for attaching; null when the session has none. */
  track: string | null;
  jumps: DetectedJump[];
}

/** One detected jump, or a session in which none was found. */
interface Row {
  key: string;
  session: FlySightSession;
  jump: DetectedJump | null;
}

/** Jumps this many days either side of a session are offered for it. */
const PICKER_DAYS = 3;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "26-10-22_10-15-30" → "2026-10-22" and "10:15:30" (the FlySight's local time, per TZ_Offset). */
function sessionStart(session: FlySightSession) {
  const [date, time] = session.name.split('_');
  return { date: `20${date}`, time: time.replaceAll('-', ':') };
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function jumpLabel(j: Jump) {
  return [`#${j.jumpNumber}`, formatDate(j.date), j.time.slice(0, 5), j.dropzone].filter(Boolean).join(' · ');
}

const MATCH_LABELS: Record<MatchKind, string> = {
  time: 'Matched by time',
  order: 'Matched by order on that day',
};

/** With `autoScan`, finds jumps in the new sessions as soon as they're listed (for a FlySight plugged into the phone). */
export default function FlySightTracks({ device, autoScan = false }: { device: FlySightFileSource; autoScan?: boolean }) {
  const user = useCurrentUser();
  const { jumps, loading: jumpsLoading } = useJumps();
  const [sessions, setSessions] = useState<FlySightSession[] | null>(null);
  const [scanned, setScanned] = useState<Map<string, ScannedSession>>(new Map());
  /** Jump picked by hand per row: a jump id, or '' for "don't attach". */
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRef = useRef(false);
  /** sensor.csv contents by session path, so a session with several jumps is downloaded once. */
  const sensorCache = useRef(new Map<string, Uint8Array<ArrayBuffer>>());

  useEffect(() => {
    let cancelled = false;
    setBusy('Listing sessions…');
    listSessions(device)
      .then((s) => !cancelled && setSessions(s))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
      stopRef.current = true;
    };
  }, [device]);

  const jumpsById = useMemo(() => new Map(jumps.map((j) => [j.id, j])), [jumps]);
  const hasAttachment = (jump: Jump | undefined, name: string) => !!jump?.attachments.some((a) => a.name === name);
  const attachedNames = useMemo(() => new Set(jumps.flatMap((j) => j.attachments.map((a) => a.name))), [jumps]);
  const isAttached = (s: FlySightSession) => attachedNames.has(attachmentName(s, TRACK_FILE));

  const rows: Row[] = useMemo(
    () =>
      (sessions ?? []).flatMap((session): Row[] => {
        const scan = scanned.get(session.path);
        if (!scan) return [];
        if (scan.jumps.length === 0) return [{ key: `${session.path}#none`, session, jump: null }];
        return scan.jumps.map((jump, i) => ({ key: `${session.path}#${i}`, session, jump }));
      }),
    [sessions, scanned],
  );

  const suggestions = useMemo(
    () => matchJumps(rows.flatMap((r) => (r.jump ? [{ key: r.key, exitTime: r.jump.exitTime }] : [])), jumps),
    [rows, jumps],
  );

  const chosenJump = (row: Row) => choices[row.key] ?? suggestions.get(row.key)?.jumpId ?? '';
  /** Rows that would attach something new. */
  const pending = rows.filter((r) => {
    const id = chosenJump(r);
    return id && !hasAttachment(jumpsById.get(id), attachmentName(r.session, TRACK_FILE));
  });

  const unscanned = (sessions ?? []).filter((s) => !scanned.has(s.path) && !isAttached(s));
  const attachedCount = (sessions ?? []).filter(isAttached).length;

  const autoScanned = useRef(false);
  useEffect(() => {
    // Waits for the logbook, which tells which sessions are attached already.
    if (!autoScan || autoScanned.current || jumpsLoading || !sessions || unscanned.length === 0) return;
    autoScanned.current = true;
    scan();
  });

  async function scan() {
    stopRef.current = false;
    setScanning(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    try {
      for (const [i, session] of unscanned.entries()) {
        if (stopRef.current) break;
        const label = `Reading ${session.name} (${i + 1} of ${unscanned.length})…`;
        setBusy(label);
        try {
          const files = await device.listDir(session.path);
          const trackFile = findFile(files, TRACK_FILE);
          let track: string | null = null;
          if (trackFile) {
            const data = await device.readFile(`${session.path}/${trackFile.name}`, (n) =>
              setBusy(`${label} ${formatBytes(n)} of ${formatBytes(trackFile.size)}`),
            );
            track = new TextDecoder().decode(data);
          }
          const result = { files, track, jumps: track ? detectJumps(parseTrack(track)) : [] };
          setScanned((m) => new Map(m).set(session.path, result));
        } catch (err) {
          if (!device.connected) throw err;
          failures.push(`${session.name}: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      setScanning(false);
    }
    if (failures.length > 0) setError(`Couldn't read some sessions:\n${failures.join('\n')}`);
  }

  async function attach() {
    setError(null);
    setNotice(null);
    // One upload per jump, so two sessions attached to the same jump don't overwrite each other's list.
    const byJump = new Map<string, Row[]>();
    for (const row of pending) byJump.set(chosenJump(row), [...(byJump.get(chosenJump(row)) ?? []), row]);

    const failures: string[] = [];
    const skippedSensors = new Set<string>();
    let attached = 0;
    try {
      for (const [jumpId, jumpRows] of byJump) {
        const jump = jumpsById.get(jumpId)!;
        const files: File[] = [];
        for (const session of new Set(jumpRows.map((r) => r.session))) {
          const scan = scanned.get(session.path)!;
          if (scan.track != null) {
            files.push(new File([scan.track], attachmentName(session, TRACK_FILE), { type: 'text/csv' }));
          }
          const sensorFile = findFile(scan.files, SENSOR_FILE);
          if (sensorFile && sensorFile.size > MAX_ATTACHMENT_BYTES) {
            skippedSensors.add(session.name);
          } else if (sensorFile) {
            let data = sensorCache.current.get(session.path);
            if (!data) {
              const label = `Reading ${session.name} sensor data…`;
              setBusy(label);
              data = await device.readFile(`${session.path}/${sensorFile.name}`, (n) =>
                setBusy(`${label} ${formatBytes(n)} of ${formatBytes(sensorFile.size)}`),
              );
              sensorCache.current.set(session.path, data);
            }
            files.push(new File([data], attachmentName(session, SENSOR_FILE), { type: 'text/csv' }));
          }
        }
        setBusy(`Uploading to jump #${jump.jumpNumber}…`);
        try {
          await attachFiles(user.uid, jump, files);
          attached += jumpRows.length;
        } catch (err) {
          failures.push(`Jump #${jump.jumpNumber}: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      failures.push(errorMessage(err));
    } finally {
      setBusy(null);
    }

    const notes = [`Attached ${attached} ${attached === 1 ? 'track' : 'tracks'}.`];
    if (skippedSensors.size > 0) {
      notes.push(
        `sensor.csv is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)} in ${[...skippedSensors].join(', ')}, so only track.csv was attached there.`,
      );
    }
    setNotice(notes.join(' '));
    if (failures.length > 0) setError(`Some uploads failed:\n${failures.join('\n')}`);
  }

  function jumpOptions(row: Row): Jump[] {
    const date = row.jump ? localDateTime(row.jump.exitTime).date : sessionStart(row.session).date;
    const near = jumps.filter((j) => Math.abs(dayNumber(j.date) - dayNumber(date)) <= PICKER_DAYS);
    const chosen = jumpsById.get(chosenJump(row));
    const options = chosen && !near.includes(chosen) ? [chosen, ...near] : near;
    return options.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || b.jumpNumber - a.jumpNumber);
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Tracks</h2>
          <p className="text-sm text-slate-500">
            The FlySight records a folder for each time it's switched on. Find jumps reads each new session's
            track.csv, detects the exits in it and suggests the matching logbook jump. Attaching uploads track.csv and
            sensor.csv to that jump.
          </p>
        </div>
        {sessions && (
          <p className="text-sm text-slate-600">
            {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} on the FlySight
            {attachedCount > 0 && `, ${attachedCount} already attached`}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {scanning ? (
            <button type="button" className="btn btn-secondary" onClick={() => (stopRef.current = true)}>
              Stop after this session
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy != null || unscanned.length === 0} onClick={scan}>
              {!sessions
                ? 'Find jumps'
                : unscanned.length === 0
                  ? 'No new sessions'
                  : `Find jumps in ${unscanned.length} new ${unscanned.length === 1 ? 'session' : 'sessions'}`}
            </button>
          )}
        </div>
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
            {busy}
          </div>
        )}
        {error && <p className="whitespace-pre-line text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-slate-600">{notice}</p>}
      </div>

      {rows.length > 0 && (
        <div className="card space-y-3">
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const start = sessionStart(row.session);
              const scan = scanned.get(row.session.path)!;
              const track = findFile(scan.files, TRACK_FILE);
              const sensor = findFile(scan.files, SENSOR_FILE);
              const suggestion = suggestions.get(row.key);
              const jumpId = chosenJump(row);
              const done = hasAttachment(jumpsById.get(jumpId), attachmentName(row.session, TRACK_FILE));
              return (
                <li key={row.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center">
                  <div className="text-sm">
                    <p className="font-medium">
                      {row.jump ? `Exit ${localDateTime(row.jump.exitTime).time.slice(0, 5)}, ${formatDate(localDateTime(row.jump.exitTime).date)}` : 'No freefall found'}
                    </p>
                    {row.jump && (
                      <p className="text-slate-600">
                        {row.jump.exitAltitude != null
                          ? `${formatAltitude(row.jump.exitAltitude)} exit, ${formatAltitude(row.jump.deploymentAltitude)} deployment, `
                          : ''}
                        {row.jump.freefallTime}s freefall
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      Session {formatDate(start.date)} {start.time}
                      {track ? ` · track ${formatBytes(track.size)}` : ' · no track.csv'}
                      {sensor && ` · sensor ${formatBytes(sensor.size)}`}
                    </p>
                  </div>
                  <div>
                    <select
                      className="input"
                      aria-label={`Jump for session ${row.session.name}`}
                      value={jumpId}
                      onChange={(e) => setChoices((c) => ({ ...c, [row.key]: e.target.value }))}
                    >
                      <option value="">Don't attach</option>
                      {jumpOptions(row).map((j) => (
                        <option key={j.id} value={j.id}>{jumpLabel(j)}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      {done
                        ? 'Already attached to this jump'
                        : jumpId && suggestion?.jumpId === jumpId && choices[row.key] == null
                          ? MATCH_LABELS[suggestion.kind]
                          : !jumpId && !suggestion
                            ? 'No matching jump in your logbook'
                            : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button type="button" className="btn btn-primary" disabled={busy != null || pending.length === 0} onClick={attach}>
              {pending.length === 0 ? 'Nothing to attach' : `Attach to ${new Set(pending.map(chosenJump)).size} ${new Set(pending.map(chosenJump)).size === 1 ? 'jump' : 'jumps'}`}
            </button>
            <span className="text-sm text-slate-500">Check the suggested jumps before attaching.</span>
          </div>
        </div>
      )}
    </div>
  );
}
