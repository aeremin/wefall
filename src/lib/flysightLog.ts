/**
 * FlySight GPS logs for the track viewer: parsing FlySight 1 and FlySight 2 track files, finding the
 * jump's phases and deriving the values the viewer plots.
 *
 * FlySight 1 writes a plain CSV with a header row and a units row:
 *   time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,heading,cAcc,gpsFix,numSV
 * FlySight 2's track.csv names its columns in a $COL row and prefixes data rows with $GNSS:
 *   $COL,GNSS,time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,numSV
 */
import { findJumpPhases, type JumpPhases, type TrackSample } from './flysightTracks';

export interface LogSample extends TrackSample {
  lat: number;
  lon: number;
  /** m/s */
  velN: number;
  velE: number;
  /** m; NaN when the file doesn't have them */
  hAcc: number;
  vAcc: number;
  numSV: number;
}

const FLYSIGHT2_COLUMNS = ['time', 'lat', 'lon', 'hMSL', 'velN', 'velE', 'velD', 'hAcc', 'vAcc', 'sAcc', 'numSV'];

/** Parses a FlySight 1 or FlySight 2 track file; rows without a position fix are skipped. */
export function parseFlySightLog(text: string): LogSample[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const samples: LogSample[] = [];
  const add = (columns: string[], values: string[]) => {
    const get = (name: string) => {
      const i = columns.indexOf(name);
      return i === -1 || values[i] === undefined || values[i] === '' ? NaN : Number(values[i]);
    };
    const s: LogSample = {
      time: Date.parse(values[columns.indexOf('time')]),
      lat: get('lat'),
      lon: get('lon'),
      hMSL: get('hMSL'),
      velN: get('velN'),
      velE: get('velE'),
      velD: get('velD'),
      hAcc: get('hAcc'),
      vAcc: get('vAcc'),
      numSV: get('numSV'),
    };
    const gpsFix = get('gpsFix');
    const valid = [s.time, s.lat, s.lon, s.hMSL, s.velN, s.velE, s.velD].every(Number.isFinite);
    if (valid && !(s.lat === 0 && s.lon === 0) && !(gpsFix < 3)) samples.push(s);
  };

  if (lines[0].startsWith('$')) {
    let columns = FLYSIGHT2_COLUMNS;
    for (const line of lines) {
      if (line.startsWith('$COL,GNSS,')) columns = line.split(',').slice(2);
      else if (line.startsWith('$GNSS,')) add(columns, line.split(',').slice(1));
    }
  } else {
    // FlySight 1; the units row has no time, so it is skipped like any other invalid row.
    const columns = lines[0].split(',').map((c) => c.trim());
    for (const line of lines.slice(1)) if (line) add(columns, line.split(','));
  }
  return samples;
}

export type Phase = 'plane' | 'freefall' | 'opening' | 'canopy' | 'ground';

export const PHASE_LABELS: Record<Phase, string> = {
  plane: 'Climb',
  freefall: 'Freefall',
  opening: 'Opening',
  canopy: 'Canopy',
  ground: 'Ground',
};

export const PHASE_COLORS: Record<Phase, string> = {
  plane: '#94a3b8',
  freefall: '#dc2626',
  opening: '#f59e0b',
  canopy: '#059669',
  ground: '#64748b',
};

export interface LogJump extends JumpPhases {
  /** Index of the deployment: the start of the opening, when the canopy starts slowing the jumper down. */
  openingStart: number;
}

/** How far back from the end of freefall the deployment is looked for. */
const OPENING_SEARCH_MS = 10_000;
/** The opening starts when the speed has dropped this far below its top speed before the opening. */
const OPENING_SLOWDOWN = 0.97;

const speed3d = (s: LogSample) => Math.hypot(s.velN, s.velE, s.velD);

/** Finds the jumps in a log, in time order. */
export function findLogJumps(samples: LogSample[]): LogJump[] {
  return findJumpPhases(samples).map((phases) => {
    // Going back from the end of freefall, the first moment the jumper was (nearly) as fast as
    // shortly before, which is where the canopy started slowing them down.
    let first = phases.deploy;
    while (first > phases.exit && samples[phases.deploy].time - samples[first - 1].time <= OPENING_SEARCH_MS) first--;
    let top = 0;
    for (let i = first; i <= phases.deploy; i++) top = Math.max(top, speed3d(samples[i]));
    let openingStart = phases.deploy;
    while (openingStart > first && speed3d(samples[openingStart]) < OPENING_SLOWDOWN * top) openingStart--;
    return { ...phases, openingStart };
  });
}

/** How long after landing a jump's part of a multi-jump log runs. */
const AFTER_LANDING_MS = 60_000;

/**
 * The part of the log [start, end] (indices) that belongs to jump `k`: from just after the
 * previous jump to a minute after this one's landing, or the end of the log for the last jump.
 */
export function jumpSlice(samples: LogSample[], jumps: LogJump[], k: number): [number, number] {
  const afterLanding = (j: LogJump, limit: number) => {
    let end = j.landing;
    while (end + 1 < limit && samples[end + 1].time - samples[j.landing].time <= AFTER_LANDING_MS) end++;
    return end;
  };
  const start = k === 0 ? 0 : afterLanding(jumps[k - 1], jumps[k].exit) + 1;
  const end = k === jumps.length - 1 ? samples.length - 1 : afterLanding(jumps[k], jumps[k + 1].exit);
  return [start, end];
}

export interface TrackPoint {
  /** ms since the epoch */
  time: number;
  /** s since exit (or since the start of the log when it has no jump) */
  t: number;
  lat: number;
  lon: number;
  /** m east and north of the exit (or the first point) */
  x: number;
  y: number;
  /** m above the landing point (or the lowest point) */
  alt: number;
  /** m/s; vertical speed is positive downwards */
  vs: number;
  hs: number;
  ts: number;
  /** Horizontal over vertical speed; null while not descending */
  glide: number | null;
  /** Degrees below the horizon; null while (nearly) standing still */
  dive: number | null;
  /** Degrees clockwise from north */
  heading: number;
  hAcc: number;
  vAcc: number;
  numSV: number;
  phase: Phase;
}

export interface Track {
  points: TrackPoint[];
  /** With indices into `points`; null when the log has no freefall. */
  jump: LogJump | null;
  /** hMSL the altitudes are measured from */
  ground: number;
}

const EARTH_RADIUS = 6_371_000;
/** Glide ratios are only meaningful while descending at least this fast (m/s). */
const MIN_GLIDE_VS = 1;
/** Dive angles are only meaningful while moving at least this fast (m/s). */
const MIN_DIVE_SPEED = 1;

/** Builds the viewer's points for samples [start, end], with `jump`'s indices relative to the whole log. */
export function buildTrack(samples: LogSample[], start: number, end: number, jump: LogJump | null): Track {
  const slice = samples.slice(start, end + 1);
  const rel = jump && {
    exit: jump.exit - start,
    openingStart: jump.openingStart - start,
    deploy: jump.deploy - start,
    landing: jump.landing - start,
    landed: jump.landed,
    ground: jump.ground,
  };
  const origin = slice[rel?.exit ?? 0];
  const ground = rel ? rel.ground : slice.reduce((min, s) => Math.min(min, s.hMSL), Infinity);
  const rad = Math.PI / 180;
  const cosLat = Math.cos(origin.lat * rad);

  const phaseAt = (i: number): Phase => {
    if (!rel) return 'canopy';
    if (i < rel.exit) return 'plane';
    if (i < rel.openingStart) return 'freefall';
    if (i <= rel.deploy) return 'opening';
    if (i <= rel.landing) return 'canopy';
    return 'ground';
  };

  const points = slice.map((s, i): TrackPoint => {
    const hs = Math.hypot(s.velN, s.velE);
    const ts = Math.hypot(hs, s.velD);
    return {
      time: s.time,
      t: (s.time - origin.time) / 1000,
      lat: s.lat,
      lon: s.lon,
      x: (s.lon - origin.lon) * rad * cosLat * EARTH_RADIUS,
      y: (s.lat - origin.lat) * rad * EARTH_RADIUS,
      alt: s.hMSL - ground,
      vs: s.velD,
      hs,
      ts,
      glide: s.velD >= MIN_GLIDE_VS ? hs / s.velD : null,
      dive: ts >= MIN_DIVE_SPEED ? Math.atan2(s.velD, hs) / rad : null,
      heading: ((Math.atan2(s.velE, s.velN) / rad) + 360) % 360,
      hAcc: s.hAcc,
      vAcc: s.vAcc,
      numSV: s.numSV,
      phase: phaseAt(i),
    };
  });
  return { points, jump: rel, ground };
}

/** Index of the last point at or before `time` (or the first point). */
export function indexAtTime(points: TrackPoint[], time: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const horizontalDistance = (a: TrackPoint, b: TrackPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/** Horizontal distance flown along the track between points a and b. */
export function pathLength(points: TrackPoint[], a: number, b: number) {
  let total = 0;
  for (let i = a + 1; i <= b; i++) total += horizontalDistance(points[i - 1], points[i]);
  return total;
}

export interface Stat {
  min: number;
  avg: number;
  max: number;
}

/** Min, time-weighted average and max of a value over points [a, b], ignoring missing values. */
export function stat(points: TrackPoint[], a: number, b: number, value: (p: TrackPoint) => number | null): Stat | null {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let weight = 0;
  for (let i = a; i <= b; i++) {
    const v = value(points[i]);
    if (v == null || !Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    const dt = (points[Math.min(i + 1, b)].time - points[Math.max(i - 1, a)].time) / 2 || 1;
    sum += v * dt;
    weight += dt;
  }
  return weight > 0 ? { min, avg: sum / weight, max } : null;
}
