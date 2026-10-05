import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useJumps } from '../context/JumpsContext';
import { daysSince, formatAltitude, formatDate, formatDuration } from '../lib/format';
import type { Jump } from '../lib/types';
import Spinner from '../components/Spinner';

const PIE_COLORS = ['#0284c7', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#64748b', '#ec4899', '#14b8a6'];

function countBy(jumps: Jump[], key: (j: Jump) => string) {
  const counts = new Map<string, number>();
  for (const j of jumps) {
    const k = key(j);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function computeStats(jumps: Jump[]) {
  const freefallJumps = jumps.filter((j) => j.freefallTime != null);
  const totalFreefall = freefallJumps.reduce((sum, j) => sum + j.freefallTime!, 0);
  const lastJump = jumps.reduce<Jump | undefined>((latest, j) => (!latest || j.date > latest.date ? j : latest), undefined);
  const currentYear = String(new Date().getFullYear());
  const exits = jumps.map((j) => j.exitAltitude).filter((a): a is number => a != null);

  const byYear = countBy(jumps, (j) => j.date.slice(0, 4))
    .map(({ name, value }) => ({ year: name, jumps: value }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const byType = countBy(jumps, (j) => j.jumpType || 'Unspecified');
  const typeData = byType.length > 7
    ? [...byType.slice(0, 7), { name: 'Other', value: byType.slice(7).reduce((s, t) => s + t.value, 0) }]
    : byType;

  return {
    total: jumps.length,
    totalFreefall,
    avgFreefall: freefallJumps.length ? totalFreefall / freefallJumps.length : null,
    lastJump,
    thisYear: jumps.filter((j) => j.date.startsWith(currentYear)).length,
    last90Days: jumps.filter((j) => daysSince(j.date) <= 90).length,
    highestExit: exits.length ? Math.max(...exits) : null,
    byYear,
    typeData,
    topDropzones: countBy(jumps.filter((j) => j.dropzone), (j) => j.dropzone).slice(0, 5),
    topAircraft: countBy(jumps.filter((j) => j.aircraft), (j) => j.aircraft).slice(0, 5),
    topCanopies: countBy(jumps.filter((j) => j.canopy), (j) => j.canopy).slice(0, 5),
  };
}

function monthlyJumps(jumps: Jump[], year: string) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: new Date(Number(year), i, 1).toLocaleDateString(undefined, { month: 'short' }),
    jumps: 0,
  }));
  for (const j of jumps) {
    if (j.date.startsWith(year)) months[Number(j.date.slice(5, 7)) - 1].jumps++;
  }
  return months;
}

export default function StatsPage() {
  const { jumps, loading } = useJumps();
  const stats = useMemo(() => computeStats(jumps), [jumps]);
  const years = stats.byYear.map((y) => y.year);
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const overviewYear = pickedYear != null && years.includes(pickedYear) ? pickedYear : years[years.length - 1];
  const yearOverview = useMemo(() => (overviewYear ? monthlyJumps(jumps, overviewYear) : []), [jumps, overviewYear]);
  const yearIdx = years.indexOf(overviewYear);

  if (loading) return <Spinner />;

  if (jumps.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-lg font-medium">No stats yet</p>
        <p className="mt-1 text-sm text-slate-500">
          <Link to="/jumps/new" className="text-sky-700 hover:underline">Log a jump</Link> to see your statistics.
        </p>
      </div>
    );
  }

  const since = stats.lastJump ? daysSince(stats.lastJump.date) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Stats</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total jumps" value={stats.total.toLocaleString()} />
        <StatCard label="Total freefall" value={formatDuration(stats.totalFreefall)} />
        <StatCard
          label="Last jump"
          value={since == null ? '–' : since === 0 ? 'Today' : `${since} ${since === 1 ? 'day' : 'days'} ago`}
          sub={stats.lastJump ? formatDate(stats.lastJump.date) : undefined}
          warn={since != null && since > 90}
        />
        <StatCard label="This year" value={stats.thisYear.toLocaleString()} sub={`${stats.last90Days} in last 90 days`} />
        <StatCard label="Avg freefall" value={stats.avgFreefall == null ? '–' : `${Math.round(stats.avgFreefall)}s`} />
        <StatCard label="Highest exit" value={formatAltitude(stats.highestExit)} />
        <StatCard label="Dropzones" value={String(new Set(jumps.map((j) => j.dropzone).filter(Boolean)).size)} />
        <StatCard label="Aircraft types" value={String(new Set(jumps.map((j) => j.aircraft).filter(Boolean)).size)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Year overview"
          action={
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-secondary px-2 py-1"
                aria-label="Previous year"
                disabled={yearIdx <= 0}
                onClick={() => setPickedYear(years[yearIdx - 1])}
              >
                ‹
              </button>
              <select
                className="input w-auto py-1"
                aria-label="Year"
                value={overviewYear}
                onChange={(e) => setPickedYear(e.target.value)}
              >
                {[...years].reverse().map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary px-2 py-1"
                aria-label="Next year"
                disabled={yearIdx >= years.length - 1}
                onClick={() => setPickedYear(years[yearIdx + 1])}
              >
                ›
              </button>
            </div>
          }
        >
          <BarChart data={yearOverview}>
            <XAxis dataKey="month" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} width={32} />
            <Tooltip />
            <Bar dataKey="jumps" fill="#0284c7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Jumps per year">
          <BarChart data={stats.byYear}>
            <XAxis dataKey="year" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} width={32} />
            <Tooltip />
            <Bar dataKey="jumps" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Jump types">
          <PieChart>
            <Pie data={stats.typeData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
              {stats.typeData.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ChartCard>
        <div className="card grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <TopList title="Top dropzones" items={stats.topDropzones} />
          <TopList title="Top aircraft" items={stats.topAircraft} />
          <TopList title="Top canopies" items={stats.topCanopies} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? 'text-amber-600' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactElement }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function TopList({ title, items }: { title: string; items: { name: string; value: number }[] }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No data</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.name} className="flex justify-between gap-2">
              <span className="truncate">{item.name}</span>
              <span className="font-medium text-slate-500">{item.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
