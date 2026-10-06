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
  'jumpNumber' | 'date' | 'exitAltitude' | 'deploymentAltitude' | 'freefallTime'
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
    exitAltitude: parseInteger(raw.exitAltitude),
    deploymentAltitude: parseInteger(raw.deploymentAltitude),
    freefallTime: parseInteger(raw.freefallTime),
  };
}
