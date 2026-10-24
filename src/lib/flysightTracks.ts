/**
 * FlySight 2 logging sessions: finding them on the device, detecting the jumps in their
 * track.csv, and matching those jumps to the logbook.
 *
 * The firmware records each power-on session into /YY-MM-DD/HH-MM-SS/ (local time per the
 * config's TZ_Offset), with track.csv holding GNSS rows in UTC:
 * $GNSS,2026-10-22T10:15:30.200Z,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV
 */
import type { FlySightDevice, FlySightFile } from './flysightBle';
import type { Jump } from './types';

const DATE_DIR_RE = /^\d\d-\d\d-\d\d$/;
const TIME_DIR_RE = /^\d\d-\d\d-\d\d$/;

export const TRACK_FILE = 'track.csv';
export const SENSOR_FILE = 'sensor.csv';

/** Where sessions are read from: a FlySight over Bluetooth, or one plugged into the phone running the WeFall app. */
export type FlySightFileSource = Pick<FlySightDevice, 'listDir' | 'readFile' | 'connected'>;

export interface FlySightSession {
  /** Folder on the device, e.g. "/26-10-22/10-15-30". */
  path: string;
  /** "26-10-22_10-15-30": prefix of the attachment names, which marks the session as attached. */
  name: string;
}

export interface TrackSample {
  /** ms since the epoch */
  time: number;
  /** m above sea level */
  hMSL: number;
  /** m/s, positive downwards */
  velD: number;
}

export interface DetectedJump {
  /** ms since the epoch */
  exitTime: number;
  deployTime: number;
  /** m above the landing elevation, or null when the track doesn't reach the ground */
  exitAltitude: number | null;
  deploymentAltitude: number | null;
  /** s */
  freefallTime: number;
}

/** Lists the dated sessions on the device, newest first. Undated sessions in /temp have no GPS fix. */
export async function listSessions(fs: FlySightFileSource): Promise<FlySightSession[]> {
  const sessions: FlySightSession[] = [];
  const dates = (await fs.listDir('/')).filter((d) => d.isDirectory && DATE_DIR_RE.test(d.name));
  for (const date of dates) {
    const times = (await fs.listDir(`/${date.name}`)).filter((t) => t.isDirectory && TIME_DIR_RE.test(t.name));
    for (const time of times) {
      sessions.push({ path: `/${date.name}/${time.name}`, name: `${date.name}_${time.name}` });
    }
  }
  return sessions.sort((a, b) => b.name.localeCompare(a.name));
}

/** The session's file with this name (the device reports 8.3 names in upper case). */
export function findFile(files: FlySightFile[], name: string): FlySightFile | undefined {
  return files.find((f) => !f.isDirectory && f.name.toLowerCase() === name);
}

export const attachmentName = (session: FlySightSession, file: string) => `${session.name}_${file}`;

export function parseTrack(text: string): TrackSample[] {
  const samples: TrackSample[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('$GNSS,')) continue;
    const cols = line.split(',');
    const time = Date.parse(cols[1]);
    const hMSL = Number(cols[4]);
    const velD = Number(cols[7]);
    if (Number.isFinite(time) && Number.isFinite(hMSL) && Number.isFinite(velD)) samples.push({ time, hMSL, velD });
  }
  return samples;
}

/** Descent rate above which the jumper counts as in freefall (canopies descend at about 5 m/s). */
const FREEFALL_SPEED = 8;
/** Shortest freefall, so a hop & pop still counts. */
const MIN_FREEFALL_MS = 3000;
/** Freefall must start this high above the session's lowest point, which rules out swoops. */
const MIN_EXIT_HEIGHT = 600;
/** Short dips below FREEFALL_SPEED (noise, a slow wingsuit) don't end the freefall. */
const MAX_GAP_MS = 3000;
/** Going back from the start of freefall, the exit is where the descent rate falls to this. */
const EXIT_SPEED = 1;

/** Finds the freefalls in a track, in time order. */
export function detectJumps(samples: TrackSample[]): DetectedJump[] {
  if (samples.length === 0) return [];
  const lowest = samples.reduce((min, s) => Math.min(min, s.hMSL), Infinity);

  // Stretches of fast descent, merging those separated by short gaps.
  const segments: { start: number; end: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].velD < FREEFALL_SPEED) continue;
    const last = segments.at(-1);
    if (last && samples[i].time - samples[last.end].time <= MAX_GAP_MS) last.end = i;
    else segments.push({ start: i, end: i });
  }

  const freefalls = segments.filter(
    (s) => samples[s.end].time - samples[s.start].time >= MIN_FREEFALL_MS && samples[s.start].hMSL - lowest >= MIN_EXIT_HEIGHT,
  );

  return freefalls.map((ff, k) => {
    let exit = ff.start;
    while (exit > 0 && samples[exit - 1].velD > EXIT_SPEED) exit--;
    const deploy = ff.end;
    // The landing is the lowest point before the next exit (or the end of the track).
    const nextExit = freefalls[k + 1]?.start ?? samples.length;
    let landing = deploy;
    for (let i = deploy; i < nextExit; i++) if (samples[i].hMSL < samples[landing].hMSL) landing = i;
    const ground = samples[landing].hMSL;
    // A track that stops in the air (FlySight switched off under canopy) never stands still near
    // its lowest point.
    let landed = false;
    for (let i = deploy; i < nextExit && !landed; i++) {
      landed = samples[i].hMSL - ground < 10 && Math.abs(samples[i].velD) < EXIT_SPEED;
    }
    const agl = (i: number) => (landed ? Math.round(samples[i].hMSL - ground) : null);
    return {
      exitTime: samples[exit].time,
      deployTime: samples[deploy].time,
      exitAltitude: agl(exit),
      deploymentAltitude: agl(deploy),
      freefallTime: Math.round((samples[deploy].time - samples[exit].time) / 1000),
    };
  });
}

/** Local calendar date (YYYY-MM-DD) and time (HH:MM:SS) of a timestamp, like the logbook's fields. */
export function localDateTime(time: number): { date: string; time: string } {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/** Logbook times this close to an exit match it. */
const MAX_TIME_DIFFERENCE_MS = 30 * 60 * 1000;

export type MatchKind = 'time' | 'order';

export interface JumpMatch {
  jumpId: string;
  kind: MatchKind;
}

/**
 * Suggests a logbook jump for each detected exit (keyed by `key`), using the browser's time zone
 * for the logbook's local dates and times:
 * - the jump on that date whose time is closest to the exit, within 30 minutes;
 * - otherwise, when the day's remaining exits and the day's jumps without a time are equally many,
 *   pairs them in order (by time and by jump number).
 * Each jump is suggested at most once.
 */
export function matchJumps(exits: { key: string; exitTime: number }[], jumps: Jump[]): Map<string, JumpMatch> {
  const matches = new Map<string, JumpMatch>();
  const byDate = new Map<string, { key: string; exitTime: number }[]>();
  for (const e of exits) {
    const { date } = localDateTime(e.exitTime);
    byDate.set(date, [...(byDate.get(date) ?? []), e]);
  }

  for (const [date, dayExits] of byDate) {
    const dayJumps = jumps.filter((j) => j.date === date);
    const used = new Set<string>();

    // Closest pairs first, so a jump goes to the exit it fits best.
    const pairs = dayExits.flatMap((e) =>
      dayJumps
        .filter((j) => j.time)
        .map((j) => ({ e, j, diff: Math.abs(new Date(`${date}T${j.time}`).getTime() - e.exitTime) })),
    );
    pairs.sort((a, b) => a.diff - b.diff);
    for (const { e, j, diff } of pairs) {
      if (diff > MAX_TIME_DIFFERENCE_MS || matches.has(e.key) || used.has(j.id)) continue;
      matches.set(e.key, { jumpId: j.id, kind: 'time' });
      used.add(j.id);
    }

    const restExits = dayExits.filter((e) => !matches.has(e.key)).sort((a, b) => a.exitTime - b.exitTime);
    const untimed = dayJumps.filter((j) => !j.time && !used.has(j.id)).sort((a, b) => a.jumpNumber - b.jumpNumber);
    if (restExits.length > 0 && restExits.length === untimed.length) {
      restExits.forEach((e, i) => matches.set(e.key, { jumpId: untimed[i].id, kind: 'order' }));
    }
  }
  return matches;
}
