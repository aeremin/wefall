import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchAttachmentText } from '../lib/attachments';
import { DEFAULT_SPEED_WINDOW_S, parseProTrackAltitudes, proTrackProfile, SAMPLE_INTERVAL_S } from '../lib/protrack';
import type { Attachment } from '../lib/types';
import Spinner from './Spinner';

const ALTITUDE_COLOR = '#0284c7';
const SPEED_COLOR = '#f59e0b';

const ALTITUDE_UNITS = { m: { factor: 1, decimals: 0 }, ft: { factor: 3.28084, decimals: 0 } };
const SPEED_UNITS = {
  'km/h': { factor: 3.6, decimals: 0 },
  'm/s': { factor: 1, decimals: 1 },
  mph: { factor: 2.23694, decimals: 0 },
};
type AltitudeUnit = keyof typeof ALTITUDE_UNITS;
type SpeedUnit = keyof typeof SPEED_UNITS;

interface PlotSettings {
  /** Half-width, in seconds, of the window vertical speed is fitted over. */
  speedWindowS: number;
  altitudeUnit: AltitudeUnit;
  speedUnit: SpeedUnit;
  showAltitude: boolean;
  showSpeed: boolean;
}

const DEFAULT_SETTINGS: PlotSettings = {
  speedWindowS: DEFAULT_SPEED_WINDOW_S,
  altitudeUnit: 'm',
  speedUnit: 'km/h',
  showAltitude: true,
  showSpeed: true,
};

const formatNumber = (n: number) => n.toLocaleString();
const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const roundTo = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** Altitude and vertical speed over time, from a ProTrack attachment, with a fullscreen view. */
export default function ProTrackChart({ ownerUid, jumpId, attachment }: { ownerUid: string; jumpId: string; attachment: Attachment }) {
  const [altitudes, setAltitudes] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [fullscreen, setFullscreen] = useState(false);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);

  useEffect(() => {
    let cancelled = false;
    setAltitudes(null);
    setError(null);
    fetchAttachmentText(ownerUid, jumpId, attachment)
      .then((text) => !cancelled && setAltitudes(parseProTrackAltitudes(text)))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [ownerUid, jumpId, attachment.id]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!altitudes) return <Spinner />;

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button type="button" className="cursor-pointer text-xs text-sky-700 hover:underline" onClick={() => setFullscreen(true)}>
          Show fullscreen
        </button>
      </div>
      <div className="h-72">
        <ProTrackPlot altitudes={altitudes} settings={settings} />
      </div>
      {fullscreen &&
        createPortal(
          <FullscreenPlot
            title={attachment.name}
            altitudes={altitudes}
            settings={settings}
            onChange={setSettings}
            onClose={closeFullscreen}
          />,
          document.body,
        )}
    </div>
  );
}

function FullscreenPlot({
  title,
  altitudes,
  settings,
  onChange,
  onClose,
}: {
  title: string;
  altitudes: number[];
  settings: PlotSettings;
  onChange: (settings: PlotSettings) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const set = <K extends keyof PlotSettings>(key: K, value: PlotSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col gap-3 bg-white p-4">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 truncate font-semibold">{title}</h2>
        <button type="button" className="btn btn-secondary ml-auto shrink-0" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-700">Speed window</span>
          <input
            type="range"
            aria-label="Speed window, seconds either side"
            min={SAMPLE_INTERVAL_S}
            max={10}
            step={SAMPLE_INTERVAL_S}
            value={settings.speedWindowS}
            onChange={(e) => set('speedWindowS', Number(e.target.value))}
            className="w-36 accent-sky-600"
          />
          <span className="w-14 tabular-nums text-slate-500">±{settings.speedWindowS} s</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-700">Altitude</span>
          <select className="input w-auto py-1" value={settings.altitudeUnit} onChange={(e) => set('altitudeUnit', e.target.value as AltitudeUnit)}>
            {Object.keys(ALTITUDE_UNITS).map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-700">Speed</span>
          <select className="input w-auto py-1" value={settings.speedUnit} onChange={(e) => set('speedUnit', e.target.value as SpeedUnit)}>
            {Object.keys(SPEED_UNITS).map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.showAltitude} onChange={(e) => set('showAltitude', e.target.checked)} className="accent-sky-600" />
          Show altitude
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.showSpeed} onChange={(e) => set('showSpeed', e.target.checked)} className="accent-sky-600" />
          Show speed
        </label>
        <button type="button" className="cursor-pointer text-xs text-sky-700 hover:underline" onClick={() => onChange(DEFAULT_SETTINGS)}>
          Reset
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <ProTrackPlot altitudes={altitudes} settings={settings} zoomable />
      </div>
      <p className="text-xs text-slate-500">Drag the handles under the chart to zoom into part of the jump.</p>
    </div>
  );
}

/** `zoomable` adds a brush under the chart for picking a time range. */
function ProTrackPlot({ altitudes, settings, zoomable = false }: { altitudes: number[]; settings: PlotSettings; zoomable?: boolean }) {
  const { speedWindowS, altitudeUnit, speedUnit, showAltitude, showSpeed } = settings;
  const data = useMemo(() => {
    const alt = ALTITUDE_UNITS[altitudeUnit];
    const speed = SPEED_UNITS[speedUnit];
    return proTrackProfile(altitudes, speedWindowS).map((s) => ({
      t: s.t,
      // `+ 0` turns -0 (flat ground readings) into 0.
      altitude: roundTo(s.altitude * alt.factor, alt.decimals) + 0,
      speed: roundTo(s.speed * speed.factor, speed.decimals) + 0,
    }));
  }, [altitudes, speedWindowS, altitudeUnit, speedUnit]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#f1f5f9" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTime} tick={{ fontSize: 12 }} />
        {/* Pinned at 0 so ground noise and the climb out of the plane don't push the axes negative. */}
        <YAxis yAxisId="altitude" hide={!showAltitude} domain={[0, 'auto']} allowDataOverflow tickFormatter={formatNumber} tick={{ fontSize: 12 }} width={52} />
        <YAxis yAxisId="speed" hide={!showSpeed} orientation="right" domain={[0, 'auto']} allowDataOverflow tick={{ fontSize: 12 }} width={40} />
        <Tooltip labelFormatter={(t) => formatTime(Number(t))} formatter={(value) => formatNumber(Number(value))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {showAltitude && (
          <Line yAxisId="altitude" dataKey="altitude" name={`Altitude (${altitudeUnit})`} stroke={ALTITUDE_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
        )}
        {showSpeed && (
          <Line yAxisId="speed" dataKey="speed" name={`Vertical speed (${speedUnit})`} stroke={SPEED_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
        )}
        {zoomable && <Brush dataKey="t" height={28} stroke={ALTITUDE_COLOR} tickFormatter={formatTime} />}
      </LineChart>
    </ResponsiveContainer>
  );
}
