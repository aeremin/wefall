import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PHASE_COLORS, type Track } from '../lib/flysightLog';
import { TILE_LAYERS } from '../lib/mapTiles';

/** How close (px) the pointer must be to the track to pick a point on it. */
const HOVER_DISTANCE_PX = 24;

/**
 * The track on a street or satellite map: the selected range [a, b] colored by phase over the rest
 * of the track in grey, with exit, deployment and landing marked. Hovering near the track reports
 * the closest point in the range.
 */
export default function TrackMap({
  track,
  range,
  hover,
  onHover,
}: {
  track: Track;
  range: [number, number];
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trackLayerRef = useRef<L.LayerGroup | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  // Read by the map's event handlers, which are only attached once.
  const latest = useRef({ track, range, onHover });
  latest.current = { track, range, onHover };

  useEffect(() => {
    // Wheel zoom only after a click on the map, so scrolling the page past it doesn't zoom it.
    const map = L.map(containerRef.current!, { scrollWheelZoom: false });
    map.on('click', () => map.scrollWheelZoom.enable());
    const layers = Object.fromEntries(
      Object.values(TILE_LAYERS).map((l) => [l.label, L.tileLayer(l.url, { maxZoom: l.maxZoom, attribution: l.attribution })]),
    );
    layers[TILE_LAYERS.map.label].addTo(map);
    L.control.layers(layers).addTo(map);
    L.control.scale().addTo(map);
    trackLayerRef.current = L.layerGroup().addTo(map);
    hoverMarkerRef.current = L.circleMarker([0, 0], {
      radius: 6,
      color: '#0f172a',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      interactive: false,
    });

    let frame = 0;
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { track, range, onHover } = latest.current;
        let best: number | null = null;
        let bestDistance = HOVER_DISTANCE_PX;
        for (let i = range[0]; i <= range[1]; i++) {
          const p = track.points[i];
          const d = map.latLngToContainerPoint([p.lat, p.lon]).distanceTo(e.containerPoint);
          if (d < bestDistance) {
            best = i;
            bestDistance = d;
          }
        }
        onHover(best);
      });
    });
    map.on('mouseout', () => {
      cancelAnimationFrame(frame);
      map.scrollWheelZoom.disable();
      latest.current.onHover(null);
    });

    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current!);
    mapRef.current = map;
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current!;
    const layer = trackLayerRef.current!;
    layer.clearLayers();
    const { points, jump } = track;
    const [a, b] = range;
    const latLng = (i: number): L.LatLngTuple => [points[i].lat, points[i].lon];

    L.polyline(points.map((p): L.LatLngTuple => [p.lat, p.lon]), { color: '#64748b', weight: 2, opacity: 0.5, interactive: false }).addTo(layer);
    // One line per run of points in the same phase, each starting where the previous one ended.
    let start = a;
    for (let i = a + 1; i <= b + 1; i++) {
      if (i <= b && points[i].phase === points[start].phase) continue;
      const line = [];
      for (let k = start; k <= Math.min(i, b); k++) line.push(latLng(k));
      L.polyline(line, { color: PHASE_COLORS[points[start].phase], weight: 4, interactive: false }).addTo(layer);
      start = i;
    }

    if (jump) {
      const markers: [number, string, string][] = [
        [jump.exit, 'Exit', PHASE_COLORS.freefall],
        [jump.openingStart, 'Deployment', PHASE_COLORS.opening],
        [jump.landing, jump.landed ? 'Landing' : 'Lowest point', PHASE_COLORS.canopy],
      ];
      for (const [i, label, color] of markers) {
        if (i < a || i > b) continue;
        L.circleMarker(latLng(i), { radius: 6, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(label)
          .addTo(layer);
      }
    }

    const bounds = L.latLngBounds(points.slice(a, b + 1).map((p): L.LatLngTuple => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
  }, [track, range]);

  useEffect(() => {
    const marker = hoverMarkerRef.current!;
    if (hover == null || !track.points[hover]) {
      marker.remove();
      return;
    }
    const p = track.points[hover];
    marker.setLatLng([p.lat, p.lon]).setStyle({ color: PHASE_COLORS[p.phase] }).addTo(mapRef.current!);
  }, [track, hover]);

  return (
    <div ref={containerRef} className="h-full min-h-72 w-full rounded-lg" />
  );
}
