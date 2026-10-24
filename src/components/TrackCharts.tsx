import { useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MouseHandlerDataParam } from 'recharts';
import { PHASE_COLORS, PHASE_LABELS, type Phase, type Track, type TrackPoint } from '../lib/flysightLog';

export const UNIT_SYSTEMS = {
  metric: { alt: { label: 'm', factor: 1 }, speed: { label: 'km/h', factor: 3.6 } },
  imperial: { alt: { label: 'ft', factor: 3.28084 }, speed: { label: 'mph', factor: 2.23694 } },
};
export type UnitSystem = keyof typeof UNIT_SYSTEMS;

type Axis = 'alt' | 'speed' | 'glide' | 'angle' | 'acc' | 'sats';

export const METRICS = {
  alt: { label: 'Altitude', axis: 'alt', color: '#0284c7' },
  vs: { label: 'Vertical speed', axis: 'speed', color: '#f59e0b' },
  hs: { label: 'Horizontal speed', axis: 'speed', color: '#16a34a' },
  ts: { label: 'Total speed', axis: 'speed', color: '#7c3aed' },
  glide: { label: 'Glide ratio', axis: 'glide', color: '#db2777' },
  dive: { label: 'Dive angle', axis: 'angle', color: '#475569' },
  hAcc: { label: 'Horizontal accuracy', axis: 'acc', color: '#0891b2' },
  vAcc: { label: 'Vertical accuracy', axis: 'acc', color: '#65a30d' },
  numSV: { label: 'Satellites', axis: 'sats', color: '#a16207' },
} satisfies Record<string, { label: string; axis: Axis; color: string }>;
export type Metric = keyof typeof METRICS;

/** The value of a metric at a point, in the given units; null when missing. */
export function metricValue(p: TrackPoint, metric: Metric, units: UnitSystem): number | null {
  const { alt, speed } = UNIT_SYSTEMS[units];
  const v = {
    alt: p.alt * alt.factor,
    vs: p.vs * speed.factor,
    hs: p.hs * speed.factor,
    ts: p.ts * speed.factor,
    glide: p.glide,
    dive: p.dive,
    hAcc: p.hAcc * alt.factor,
    vAcc: p.vAcc * alt.factor,
    numSV: p.numSV,
  }[metric];
  return v != null && Number.isFinite(v) ? v : null;
}

export function metricUnit(metric: Metric, units: UnitSystem) {
  const axis = METRICS[metric].axis;
  if (axis === 'alt' || axis === 'acc') return UNIT_SYSTEMS[units].alt.label;
  if (axis === 'speed') return UNIT_SYSTEMS[units].speed.label;
  if (axis === 'angle') return '°';
  return '';
}

/** "−1:05", "0:42": time from exit. */
export function formatT(t: number) {
  const s = Math.round(Math.abs(t));
  return `${t < -0.5 ? '−' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Climb rates (in the chart's units) below which the speed axis stays at 0, hiding GPS noise on the ground. */
const MIN_SHOWN_CLIMB = 5;

/** Charts get at most about this many points, which keeps hovering smooth on long logs. */
const MAX_CHART_POINTS = 1500;

/** Indices of the points in [a, b] the charts plot, always including both ends. */
function chartIndices(a: number, b: number) {
  const step = Math.max(1, Math.ceil((b - a + 1) / MAX_CHART_POINTS));
  const indices = [];
  for (let i = a; i < b; i += step) indices.push(i);
  indices.push(b);
  return indices;
}

/** Runs of consecutive points in the same phase within [a, b], as [phase, first, last] indices. */
function phaseRuns(points: TrackPoint[], a: number, b: number): [Phase, number, number][] {
  const runs: [Phase, number, number][] = [];
  for (let i = a; i <= b; i++) {
    const last = runs.at(-1);
    if (last && last[0] === points[i].phase) last[2] = i;
    else runs.push([points[i].phase, i, i]);
  }
  return runs;
}

const activeIndex = (state: MouseHandlerDataParam) =>
  state.activeIndex == null || state.activeIndex === '' ? null : Number(state.activeIndex);

/**
 * The chosen metrics over time for points [a, b], over the jump's phases. Hovering reports the point
 * under the pointer; dragging across the chart zooms into that stretch.
 */
export function TimeChart({
  track,
  range,
  units,
  metrics,
  hover,
  onHover,
  onZoom,
}: {
  track: Track;
  range: [number, number];
  units: UnitSystem;
  metrics: Metric[];
  hover: number | null;
  onHover: (index: number | null) => void;
  onZoom: (range: [number, number]) => void;
}) {
  const [a, b] = range;
  const { points } = track;
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // Also kept in a ref, since a quick drag can end before the chart re-renders with it.
  const dragStart = useRef<number | null>(null);

  const data = useMemo(
    () =>
      chartIndices(a, b).map((i) => {
        const row: Record<string, number | null> = { i, t: points[i].t };
        for (const m of Object.keys(METRICS) as Metric[]) row[m] = metricValue(points[i], m, units);
        return row;
      }),
    [points, a, b, units],
  );
  // A log without a jump has no phases to show.
  const runs = useMemo(() => (track.jump ? phaseRuns(points, a, b) : []), [track.jump, points, a, b]);

  const pointAt = (state: MouseHandlerDataParam) => {
    const k = activeIndex(state);
    return k == null || !data[k] ? null : (data[k].i as number);
  };
  const shown = new Set(metrics.map((m) => METRICS[m].axis));
  const hidden = (axis: Axis) => axis === 'alt' || axis === 'speed' ? !shown.has(axis) : true;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        // Its keyboard navigation moves a tooltip this chart doesn't show, and leaves a focus ring after a drag.
        accessibilityLayer={false}
        margin={{ top: 16, right: 4, bottom: 0, left: 4 }}
        onMouseDown={(state) => {
          dragStart.current = pointAt(state);
          if (dragStart.current != null) setDrag({ from: dragStart.current, to: dragStart.current });
        }}
        onMouseMove={(state) => {
          const i = pointAt(state);
          onHover(i);
          if (dragStart.current != null && i != null) setDrag({ from: dragStart.current, to: i });
        }}
        onMouseUp={(state) => {
          const from = dragStart.current;
          const to = pointAt(state) ?? drag?.to;
          if (from != null && to != null && Math.abs(points[to].time - points[from].time) >= 1000) {
            onZoom([Math.min(from, to), Math.max(from, to)]);
          }
          dragStart.current = null;
          setDrag(null);
        }}
        onMouseLeave={() => {
          onHover(null);
          dragStart.current = null;
          setDrag(null);
        }}
        style={{ userSelect: 'none' }}
      >
        <CartesianGrid stroke="#f1f5f9" />
        {runs.map(([phase, first, last]) => (
          <ReferenceArea
            key={first}
            yAxisId="alt"
            x1={points[first].t}
            x2={points[last].t}
            fill={PHASE_COLORS[phase]}
            fillOpacity={0.08}
            strokeOpacity={0}
            label={{ value: PHASE_LABELS[phase].toUpperCase(), position: 'insideTop', fontSize: 10, fill: '#64748b', dy: -14 }}
            ifOverflow="hidden"
          />
        ))}
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatT} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="alt" hide={hidden('alt')} domain={[0, 'auto']} allowDataOverflow tickFormatter={(v: number) => v.toLocaleString()} tick={{ fontSize: 12 }} width={52} />
        <YAxis yAxisId="speed" hide={hidden('speed')} orientation="right" domain={[(min: number) => (min < -MIN_SHOWN_CLIMB ? min : 0), 'auto']} allowDataOverflow tick={{ fontSize: 12 }} width={40} />
        {/* Glide ratios shoot up when the descent nearly stops, so their axis is capped. */}
        <YAxis yAxisId="glide" hide width={0} domain={[0, 5]} allowDataOverflow />
        <YAxis yAxisId="angle" hide width={0} domain={[-30, 90]} allowDataOverflow />
        <YAxis yAxisId="acc" hide width={0} domain={[0, 'auto']} />
        <YAxis yAxisId="sats" hide width={0} domain={[0, 'auto']} />
        {/* Only there so the chart tracks the hovered point; the viewer shows its values. */}
        <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
        {metrics.map((m) => (
          <Line
            key={m}
            yAxisId={METRICS[m].axis}
            dataKey={m}
            name={METRICS[m].label}
            stroke={METRICS[m].color}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
        {hover != null && hover >= a && hover <= b && (
          <ReferenceLine yAxisId="alt" x={points[hover].t} stroke="#0f172a" strokeDasharray="3 3" />
        )}
        {drag && drag.from !== drag.to && (
          <ReferenceArea yAxisId="alt" x1={points[drag.from].t} x2={points[drag.to].t} fill="#0284c7" fillOpacity={0.15} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Looking towards each direction, the horizontal axis runs to the right: east when looking north. */
const DIRECTIONS = {
  N: { label: 'North', x: (p: TrackPoint) => p.x },
  E: { label: 'East', x: (p: TrackPoint) => -p.y },
  S: { label: 'South', x: (p: TrackPoint) => -p.x },
  W: { label: 'West', x: (p: TrackPoint) => p.y },
};
type Direction = keyof typeof DIRECTIONS;

/** Altitude against horizontal position for points [a, b], seen from the side. */
export function ProfileChart({
  track,
  range,
  units,
  hover,
}: {
  track: Track;
  range: [number, number];
  units: UnitSystem;
  hover: number | null;
}) {
  const [a, b] = range;
  const { points } = track;
  const [direction, setDirection] = useState<Direction>('N');
  const factor = UNIT_SYSTEMS[units].alt.factor;
  const toRow = useMemo(() => {
    const x = DIRECTIONS[direction].x;
    return (p: TrackPoint) => ({ x: x(p) * factor, alt: p.alt * factor });
  }, [direction, factor]);

  const lines = useMemo(() => {
    const indices = chartIndices(a, b);
    return phaseRuns(points, a, b).map(([phase, first, last]) => ({
      phase,
      first,
      // Each run also takes the next run's first point, so the lines join up.
      data: [...indices.filter((i) => i >= first && i <= last), Math.min(last + 1, b)].map((i) => toRow(points[i])),
    }));
  }, [points, a, b, toRow]);

  const hovered = hover != null && hover >= a && hover <= b ? toRow(points[hover]) : null;

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Looking</span>
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Viewing direction">
          {(Object.keys(DIRECTIONS) as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={direction === d}
              title={`Looking ${DIRECTIONS[d].label.toLowerCase()}`}
              className={`cursor-pointer rounded-md px-2 py-0.5 font-medium ${direction === d ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setDirection(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="#f1f5f9" />
            <XAxis dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={(v: number) => Math.round(v).toLocaleString()} tick={{ fontSize: 11 }} />
            <YAxis dataKey="alt" type="number" domain={[0, 'auto']} allowDataOverflow tickFormatter={(v: number) => v.toLocaleString()} tick={{ fontSize: 11 }} width={48} />
            {lines.map((l) => (
              <Line key={l.first} data={l.data} dataKey="alt" stroke={PHASE_COLORS[l.phase]} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
            ))}
            {hovered && <ReferenceDot x={hovered.x} y={hovered.alt} r={5} fill="#ffffff" stroke="#0f172a" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
