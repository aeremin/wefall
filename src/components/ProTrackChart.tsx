import { useEffect, useState } from 'react';
import {
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
import { parseProTrackSamples, type ProTrackSample } from '../lib/protrack';
import type { Attachment } from '../lib/types';
import Spinner from './Spinner';

const ALTITUDE_COLOR = '#0284c7';
const SPEED_COLOR = '#f59e0b';

const formatNumber = (n: number) => n.toLocaleString();
const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Altitude and vertical speed over time, from a ProTrack attachment. */
export default function ProTrackChart({ ownerUid, jumpId, attachment }: { ownerUid: string; jumpId: string; attachment: Attachment }) {
  const [samples, setSamples] = useState<ProTrackSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSamples(null);
    setError(null);
    fetchAttachmentText(ownerUid, jumpId, attachment)
      .then((text) => !cancelled && setSamples(parseProTrackSamples(text)))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [ownerUid, jumpId, attachment.id]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!samples) return <Spinner />;

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="#f1f5f9" />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            tick={{ fontSize: 12 }}
          />
          {/* Pinned at 0 so ground noise and the climb out of the plane don't push the axes negative. */}
          <YAxis yAxisId="altitude" domain={[0, 'auto']} allowDataOverflow tickFormatter={formatNumber} tick={{ fontSize: 12 }} width={48} />
          <YAxis yAxisId="speed" orientation="right" domain={[0, 'auto']} allowDataOverflow tick={{ fontSize: 12 }} width={40} />
          <Tooltip
            labelFormatter={(t) => formatTime(Number(t))}
            formatter={(value) => formatNumber(Number(value))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="altitude" dataKey="altitude" name="Altitude (m)" stroke={ALTITUDE_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="speed" dataKey="speed" name="Vertical speed (km/h)" stroke={SPEED_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
