import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  buildTrack,
  findLogJumps,
  horizontalDistance,
  indexAtTime,
  jumpSlice,
  pathLength,
  stat,
  type LogSample,
  type Track,
} from '../lib/flysightLog';
import { formatDuration } from '../lib/format';
import TrackMap from './TrackMap';
import {
  formatT,
  METRICS,
  metricUnit,
  metricValue,
  ProfileChart,
  TimeChart,
  UNIT_SYSTEMS,
  type Metric,
  type UnitSystem,
} from './TrackCharts';

type View = 'all' | 'jump' | 'freefall' | 'opening' | 'canopy' | 'landing';

const VIEW_LABELS: Record<View, string> = {
  all: 'All',
  jump: 'Jump',
  freefall: 'Freefall',
  opening: 'Opening',
  canopy: 'Canopy',
  landing: 'Landing',
};

const DEFAULT_METRICS: Metric[] = ['alt', 'vs', 'hs'];
/** Metrics the readout and range statistics list. */
const SUMMARY_METRICS: Metric[] = ['alt', 'vs', 'hs', 'ts', 'glide', 'dive'];

/** Height above the landing point (m) below which the plane counts as on the ground. */
const TAKEOFF_HEIGHT = 30;

/** Points [a, b] a view shows, or null when the track has no jump to show it for. */
function viewRange(track: Track, view: View): [number, number] | null {
  const { points, jump } = track;
  if (view === 'all') return [0, points.length - 1];
  if (!jump) return null;
  const at = (i: number, offsetS: number) => indexAtTime(points, points[i].time + offsetS * 1000);
  switch (view) {
    case 'jump':
      return [at(jump.exit, -10), Math.min(at(jump.landing, 10) + 1, points.length - 1)];
    case 'freefall':
      return [jump.exit, jump.openingStart];
    case 'opening':
      return [at(jump.openingStart, -2), Math.min(at(jump.deploy, 3) + 1, points.length - 1)];
    case 'canopy':
      return [jump.deploy, jump.landing];
    case 'landing':
      return [at(jump.landing, -30), Math.min(at(jump.landing, 10) + 1, points.length - 1)];
  }
}

/** Map, side profile, charts and statistics of a FlySight log, one jump at a time. */
export default function TrackViewer({ samples, logbookTime }: { samples: LogSample[]; logbookTime: number | null }) {
  const jumps = useMemo(() => findLogJumps(samples), [samples]);
  // The jump closest to the logbook's time, or the first one.
  const [jumpIndex, setJumpIndex] = useState(() => {
    if (logbookTime == null || jumps.length === 0) return 0;
    const diffs = jumps.map((j) => Math.abs(samples[j.exit].time - logbookTime));
    return diffs.indexOf(Math.min(...diffs));
  });
  const track = useMemo(() => {
    if (jumps.length === 0) return buildTrack(samples, 0, samples.length - 1, null);
    const [start, end] = jumpSlice(samples, jumps, jumpIndex);
    return buildTrack(samples, start, end, jumps[jumpIndex]);
  }, [samples, jumps, jumpIndex]);

  const [view, setView] = useState<View>(jumps.length > 0 ? 'jump' : 'all');
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [units, setUnits] = useState<UnitSystem>('metric');
  const [metrics, setMetrics] = useState<Metric[]>(DEFAULT_METRICS);
  const [hover, setHover] = useState<number | null>(null);
  const onHover = useCallback((i: number | null) => setHover(i), []);

  const viewed = useMemo((): [number, number] => viewRange(track, view) ?? [0, track.points.length - 1], [track, view]);
  const range = zoom ?? viewed;

  function selectView(v: View) {
    setView(v);
    setZoom(null);
  }

  function selectJump(k: number) {
    setJumpIndex(k);
    setZoom(null);
    setHover(null);
  }

  function toggleMetric(m: Metric) {
    setMetrics((current) =>
      current.includes(m) ? current.filter((x) => x !== m) : (Object.keys(METRICS) as Metric[]).filter((x) => x === m || current.includes(x)),
    );
  }

  const views = (Object.keys(VIEW_LABELS) as View[]).filter((v) => viewRange(track, v));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ToggleGroup label="View" options={views.map((v) => [v, VIEW_LABELS[v]])} value={zoom ? null : view} onChange={selectView} />
        {jumps.length > 1 && (
          <ToggleGroup
            label="Jump"
            options={jumps.map((j, k) => [k, `${k + 1} · ${new Date(samples[j.exit].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`])}
            value={jumpIndex}
            onChange={selectJump}
          />
        )}
        <ToggleGroup label="Units" options={[['metric', 'Metric'], ['imperial', 'Imperial']]} value={units} onChange={setUnits} />
        {zoom && (
          <button type="button" className="cursor-pointer text-sm text-sky-700 hover:underline" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        )}
      </div>

      {jumps.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No freefall found in this log, so it is shown whole, with altitudes above its lowest point.
        </p>
      )}
      {track.jump && !track.jump.landed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The log stops before the landing, so altitudes are above its lowest point rather than the ground.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card h-96 p-1 lg:col-span-2 lg:h-[28rem]">
          <TrackMap track={track} range={range} hover={hover} onHover={onHover} />
        </div>
        <div className="card h-80 lg:h-[28rem]">
          <ProfileChart track={track} range={range} units={units} hover={hover} />
        </div>
      </div>

      <Readout track={track} hover={hover} units={units} />

      <div className="card space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Plotted values">
          {(Object.keys(METRICS) as Metric[]).map((m) => {
            const on = metrics.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? 'border-slate-300 bg-white text-slate-800' : 'border-transparent bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                onClick={() => toggleMetric(m)}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? METRICS[m].color : '#cbd5e1' }} />
                {METRICS[m].label}
              </button>
            );
          })}
        </div>
        <div className="h-80">
          <TimeChart track={track} range={range} units={units} metrics={metrics} hover={hover} onHover={onHover} onZoom={setZoom} />
        </div>
        <p className="text-xs text-slate-500">
          Time from exit. Drag across the chart to zoom in; altitude is on the left axis and speeds on the right.
        </p>
      </div>

      <RangeStats track={track} range={range} units={units} />
      {track.jump && <JumpSummary track={track} units={units} />}
    </div>
  );
}

function ToggleGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          className={`shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-sm font-medium sm:px-3 ${v === value ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function formatValue(v: number | null, metric: Metric) {
  if (v == null) return '–';
  const decimals = metric === 'glide' ? 2 : 0;
  // `+ 0` turns -0 (rounded noise around zero) into 0.
  return (Number(v.toFixed(decimals)) + 0).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function withUnit(v: number | null, metric: Metric, units: UnitSystem) {
  const unit = metricUnit(metric, units);
  return v == null ? '–' : `${formatValue(v, metric)}${unit && unit !== '°' ? ' ' : ''}${unit}`;
}

/** The values at the hovered point. */
function Readout({ track, hover, units }: { track: Track; hover: number | null; units: UnitSystem }) {
  const p = hover == null ? null : track.points[hover];
  return (
    <div className="card flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
      {p ? (
        <>
          <Value label="Time">
            {formatT(p.t)} <span className="text-slate-500">({new Date(p.time).toLocaleTimeString()})</span>
          </Value>
          {SUMMARY_METRICS.map((m) => (
            <Value key={m} label={METRICS[m].label}>{withUnit(metricValue(p, m, units), m, units)}</Value>
          ))}
          <Value label="Heading">{Math.round(p.heading)}°</Value>
        </>
      ) : (
        <p className="text-slate-500">Hover over the map or the charts to see the values at that point.</p>
      )}
    </div>
  );
}

function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="tabular-nums">{children}</div>
    </div>
  );
}

/** Min, average and max of each value over the shown points. */
function RangeStats({ track, range, units }: { track: Track; range: [number, number]; units: UnitSystem }) {
  const [a, b] = range;
  const { points } = track;
  const distance = pathLength(points, a, b) * UNIT_SYSTEMS[units].alt.factor;
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <h2 className="font-semibold">Shown section</h2>
        <span className="text-sm text-slate-500">
          {formatT(points[a].t)} to {formatT(points[b].t)} · {formatDuration((points[b].time - points[a].time) / 1000)} ·{' '}
          {Math.round(distance).toLocaleString()} {UNIT_SYSTEMS[units].alt.label} flown
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Min</th>
              <th className="py-1 text-right font-medium">Avg</th>
              <th className="py-1 text-right font-medium">Max</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {SUMMARY_METRICS.map((m) => {
              const s = stat(points, a, b, (p) => metricValue(p, m, units));
              return (
                <tr key={m}>
                  <td className="py-1">
                    {METRICS[m].label}
                    {metricUnit(m, units) && <span className="text-slate-500"> ({metricUnit(m, units)})</span>}
                  </td>
                  <td className="py-1 text-right">{formatValue(s?.min ?? null, m)}</td>
                  <td className="py-1 text-right">{formatValue(s?.avg ?? null, m)}</td>
                  <td className="py-1 text-right">{formatValue(s?.max ?? null, m)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Key numbers of each phase of the jump. */
function JumpSummary({ track, units }: { track: Track; units: UnitSystem }) {
  const { points, ground } = track;
  const jump = track.jump!;
  const { alt: altUnit, speed: speedUnit } = UNIT_SYSTEMS[units];
  const alt = (m: number) => `${Math.round(m * altUnit.factor).toLocaleString()} ${altUnit.label}`;
  const speed = (ms: number) => `${Math.round(ms * speedUnit.factor).toLocaleString()} ${speedUnit.label}`;
  const seconds = (a: number, b: number) => formatDuration((points[b].time - points[a].time) / 1000);
  const ratio = (r: number | null) => (r == null || !Number.isFinite(r) ? '–' : r.toFixed(2));
  const statOf = (a: number, b: number, key: 'vs' | 'hs') => stat(points, a, b, (p) => p[key]) ?? { min: 0, avg: 0, max: 0 };

  const exit = points[jump.exit];
  const opening = points[jump.openingStart];
  const deploy = points[jump.deploy];
  const landing = points[jump.landing];
  const canopyDistance = pathLength(points, jump.deploy, jump.landing);
  const canopyDrop = deploy.alt - landing.alt;
  const intervals = points.slice(1).map((p, i) => p.time - points[i].time).sort((x, y) => x - y);
  const sampleInterval = (intervals[Math.floor(intervals.length / 2)] ?? 0) / 1000;
  // The last time the plane was near the ground before exit; -1 when the log starts in the air.
  let takeoff = jump.exit - 1;
  while (takeoff >= 0 && points[takeoff].alt >= TAKEOFF_HEIGHT) takeoff--;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SummaryCard title="Freefall">
        <Row label="Exit altitude">{alt(exit.alt)}</Row>
        <Row label="Exit time">{new Date(exit.time).toLocaleTimeString()}</Row>
        <Row label="Freefall time">{seconds(jump.exit, jump.openingStart)}</Row>
        <Row label="Max vertical speed">{speed(statOf(jump.exit, jump.openingStart, 'vs').max)}</Row>
        <Row label="Avg vertical speed">{speed(statOf(jump.exit, jump.openingStart, 'vs').avg)}</Row>
        <Row label="Max horizontal speed">{speed(statOf(jump.exit, jump.openingStart, 'hs').max)}</Row>
        <Row label="Distance from exit">{alt(horizontalDistance(exit, opening))}</Row>
      </SummaryCard>
      <SummaryCard title="Opening">
        <Row label="Deployment altitude">{alt(opening.alt)}</Row>
        <Row label="Duration">{seconds(jump.openingStart, jump.deploy)}</Row>
        <Row label="Altitude lost">{alt(opening.alt - deploy.alt)}</Row>
        <Row label="Speed before">{speed(opening.ts)}</Row>
        <Row label="Speed after">{speed(deploy.ts)}</Row>
      </SummaryCard>
      <SummaryCard title="Canopy">
        <Row label="Canopy time">{seconds(jump.deploy, jump.landing)}</Row>
        <Row label="Avg descent rate">{speed(statOf(jump.deploy, jump.landing, 'vs').avg)}</Row>
        <Row label="Avg horizontal speed">{speed(statOf(jump.deploy, jump.landing, 'hs').avg)}</Row>
        <Row label="Glide ratio">{ratio(canopyDrop > 0 ? canopyDistance / canopyDrop : null)}</Row>
        <Row label="Distance flown">{alt(canopyDistance)}</Row>
      </SummaryCard>
      <SummaryCard title={jump.landed ? 'Landing' : 'Lowest point'}>
        <Row label="Position">
          <a
            className="text-sky-700 hover:underline"
            href={`https://www.openstreetmap.org/?mlat=${landing.lat.toFixed(6)}&mlon=${landing.lon.toFixed(6)}#map=17/${landing.lat.toFixed(6)}/${landing.lon.toFixed(6)}`}
            target="_blank"
            rel="noreferrer"
          >
            {landing.lat.toFixed(5)}, {landing.lon.toFixed(5)}
          </a>
        </Row>
        <Row label="Distance from exit">{alt(horizontalDistance(exit, landing))}</Row>
        <Row label="Final heading">{Math.round(points[Math.max(jump.deploy, jump.landing - 1)].heading)}°</Row>
        <Row label="Elevation (MSL)">{alt(ground)}</Row>
      </SummaryCard>
      <SummaryCard title="Recording">
        <Row label="Start">{new Date(points[0].time).toLocaleString()}</Row>
        <Row label="Duration">{seconds(0, points.length - 1)}</Row>
        <Row label="Sample rate">{sampleInterval > 0 ? `${Math.round(1 / sampleInterval)} Hz` : '–'}</Row>
        <Row label="Points">{points.length.toLocaleString()}</Row>
        <Row label="Climb">{takeoff === -1 ? '–' : seconds(takeoff, jump.exit)}</Row>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <dl className="space-y-1 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
