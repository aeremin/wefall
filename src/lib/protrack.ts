import { parseTime } from './format';
import type { JumpInput } from './types';

/** Fields of the JIB (Jump Information) block, in file order. */
const JIB_FIELDS = [
  'fileVersion',
  'device',
  'firmwareVersion',
  'serialNumber',
  'jumpNumber',
  'date',
  'time',
  'exitAltitude',
  'deploymentAltitude',
  'freefallTime',
] as const;

export type ProTrackJump = Pick<
  JumpInput,
  'jumpNumber' | 'date' | 'time' | 'exitAltitude' | 'deploymentAltitude' | 'freefallTime'
>;

function contentLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function isProTrackFile(text: string) {
  return contentLines(text)[0] === 'JIB';
}

function parseInteger(raw: string | undefined) {
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Parses a ProTrack II jump file (one jump per file). Throws on malformed input. */
export function parseProTrackFile(text: string): ProTrackJump {
  const lines = contentLines(text);
  const end = lines.indexOf('JIE');
  if (lines[0] !== 'JIB' || end === -1) throw new Error('Not a ProTrack jump file');

  const block = lines.slice(1, end);
  if (block.length < JIB_FIELDS.length) throw new Error('Jump information block is incomplete');
  const raw = Object.fromEntries(JIB_FIELDS.map((f, i) => [f, block[i]])) as Record<
    (typeof JIB_FIELDS)[number],
    string
  >;

  const jumpNumber = parseInteger(raw.jumpNumber);
  if (jumpNumber == null || jumpNumber <= 0) throw new Error(`Invalid jump number "${raw.jumpNumber}"`);

  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.date);
  const [y, m, day] = d ? d.slice(1).map(Number) : [0, 0, 0];
  const parsed = new Date(Date.UTC(y, m - 1, day));
  if (!d || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`Invalid date "${raw.date}"`);
  }

  return {
    jumpNumber,
    date: `${d[1]}-${d[2]}-${d[3]}`,
    time: parseTime(raw.time) ?? '',
    exitAltitude: parseInteger(raw.exitAltitude),
    deploymentAltitude: parseInteger(raw.deploymentAltitude),
    freefallTime: parseInteger(raw.freefallTime),
  };
}

/** ProTrack II logs pressure every 0.25 s, in freefall and under canopy alike. */
export const SAMPLE_INTERVAL_S = 0.25;
/** Default half-width of the window vertical speed is fitted over. */
export const DEFAULT_SPEED_WINDOW_S = 3;

export interface ProTrackSample {
  /** seconds since the first sample */
  t: number;
  /** meters above the ground reference */
  altitude: number;
  /** descent rate in m/s (positive when falling) */
  speed: number;
}

/**
 * Parses the PIB (pressure) block into altitudes in meters above the ground reference, one per sample.
 * The block starts with the ground pressure and three more header fields, then the samples; pressures
 * are in tenths of hPa.
 */
export function parseProTrackAltitudes(text: string): number[] {
  const lines = contentLines(text);
  const start = lines.indexOf('PIB');
  const end = lines.indexOf('PIE');
  if (start === -1 || end < start + 5) throw new Error('No altitude data in this ProTrack file');

  const ground = Number(lines[start + 1]);
  const pressures = lines
    .slice(start + 5, end)
    .flatMap((l) => l.split(','))
    .filter((v) => v.trim())
    .map(Number);
  if (!(ground > 0) || pressures.length < 2 || pressures.some((p) => !(p > 0))) {
    throw new Error('Altitude data in this ProTrack file is malformed');
  }

  // International standard atmosphere, relative to the ground pressure.
  return pressures.map((p) => 44330 * (1 - (p / ground) ** (1 / 5.255)));
}

/** Pairs each altitude with its descent rate, fitted over ±`speedWindowS` seconds. */
export function proTrackProfile(altitudes: number[], speedWindowS = DEFAULT_SPEED_WINDOW_S): ProTrackSample[] {
  const halfWindow = Math.max(1, Math.round(speedWindowS / SAMPLE_INTERVAL_S));
  return altitudes.map((altitude, i) => ({
    t: i * SAMPLE_INTERVAL_S,
    altitude,
    speed: descentRate(altitudes, i, halfWindow),
  }));
}

/**
 * Descent rate, in m/s, from the slope of the least-squares line through the altitudes within
 * `halfWindow` samples of sample `i`. Every sample in the window counts, so it is far less jittery
 * than the difference between the window's two ends.
 */
function descentRate(altitude: number[], i: number, halfWindow: number) {
  const a = Math.max(0, i - halfWindow);
  const b = Math.min(altitude.length - 1, i + halfWindow);
  const meanX = (a + b) / 2;
  let meanY = 0;
  for (let k = a; k <= b; k++) meanY += altitude[k] / (b - a + 1);
  let num = 0;
  let den = 0;
  for (let k = a; k <= b; k++) {
    num += (meanX - k) * (altitude[k] - meanY);
    den += (k - meanX) ** 2;
  }
  return num / den / SAMPLE_INTERVAL_S;
}
