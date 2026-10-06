export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Parses "H:MM", "HH:MM:SS" or "HHMMSS" into HH:MM:SS; returns null if not a valid time of day. */
export function parseTime(raw: string): string | null {
  const s = raw.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s) ?? /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!match) return null;
  const [h, m, sec] = [match[1], match[2], match[3] ?? '0'].map(Number);
  if (h > 23 || m > 59 || sec > 59) return null;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function daysSince(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86_400_000);
}

export function formatAltitude(meters: number | null) {
  return meters == null ? '–' : `${meters.toLocaleString()} m`;
}

export function formatSeconds(seconds: number | null) {
  return seconds == null ? '–' : `${seconds}s`;
}

export function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
