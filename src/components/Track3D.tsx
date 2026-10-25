import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { localXY, PHASE_COLORS, type Track, type TrackPoint } from '../lib/flysightLog';
import { TILE_LAYERS, tileAt, tileCorner, tileUrl, type TileLayer } from '../lib/mapTiles';

/** How close (px) the pointer must be to the track to pick a point on it. */
const HOVER_DISTANCE_PX = 24;
/** The ground covers the shown part of the track plus this share of its width or height, whichever is larger, on every side. */
const GROUND_MARGIN = 0.4;
/** Smallest ground width (m), so a short stretch of track still shows its surroundings. */
const MIN_GROUND_SIZE = 800;
/** Most map tiles the ground is made of; the zoom level is the highest that stays within it. */
const MAX_TILES = 30;
const MAX_TILE_ZOOM = 17;
/** Share of the view the shown part of the track fills when framed. */
const FILL = 0.85;

/** Scene coordinates: x east, y up, z south (three.js is right-handed with y up). */
const toVector = (p: TrackPoint, height = p.alt) => new THREE.Vector3(p.x, height, -p.y);

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  ground: THREE.Group;
  trackGroup: THREE.Group;
  hoverGroup: THREE.Group;
  /** Fat-line materials, which need the canvas size to draw their width in pixels. */
  lineMaterials: Set<LineMaterial>;
}

/** Sprites without size attenuation are sized as a share of the view's height. */
const setDotSize = (sprite: THREE.Sprite, viewHeight: number) => sprite.scale.setScalar(sprite.userData.px / viewHeight);

/** A dot `px` pixels across however far away it is, in a view `viewHeight` pixels high. */
function dot(fill: string, px: number, viewHeight: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = fill === '#ffffff' ? '#0f172a' : '#ffffff';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false }));
  sprite.userData.px = px;
  setDotSize(sprite, viewHeight);
  sprite.renderOrder = 1;
  return sprite;
}

/** Disposes the geometries, materials and textures of an object's descendants and removes them. */
function clearGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o === group) return;
    const mesh = o as THREE.Mesh;
    // All sprites share one geometry.
    if (!(o instanceof THREE.Sprite)) mesh.geometry?.dispose();
    for (const m of [mesh.material ?? []].flat()) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
  group.clear();
}

/**
 * The shown part of the track in 3D over a map of the ground, colored by phase, which can be turned, tilted and zoomed.
 * Optionally drops lines from the track to the ground every few seconds and draws its shadow, which
 * makes heights and positions easier to read. Hovering near the track reports the closest point.
 */
export default function Track3D({
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
  const sceneRef = useRef<Scene3D | null>(null);
  const [layer, setLayer] = useState<TileLayer>('map');
  const [projection, setProjection] = useState(true);
  const [dropInterval, setDropInterval] = useState(5);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read by the canvas's event handlers, which are only attached once.
  const latest = useRef({ track, range, onHover });
  latest.current = { track, range, onHover };

  useEffect(() => {
    const container = containerRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("This browser can't show 3D graphics (WebGL is unavailable).");
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e2e8f0');
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Stay above the ground.
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    // Wheel zoom only after a click, so scrolling the page past the view doesn't zoom it.
    controls.enableZoom = false;
    const ground = new THREE.Group();
    const trackGroup = new THREE.Group();
    const hoverGroup = new THREE.Group();
    scene.add(ground, trackGroup, hoverGroup);
    const lineMaterials = new Set<LineMaterial>();
    sceneRef.current = { renderer, scene, camera, controls, ground, trackGroup, hoverGroup, lineMaterials };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const m of lineMaterials) m.resolution.set(w, h);
      scene.traverse((o) => o instanceof THREE.Sprite && setDotSize(o, h));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    let frame = 0;
    const onPointerMove = (e: PointerEvent) => {
      // Picking while turning the view would make the readout flicker.
      if (e.buttons !== 0) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { track, range, onHover } = latest.current;
        const rect = renderer.domElement.getBoundingClientRect();
        const v = new THREE.Vector3();
        let best: number | null = null;
        let bestDistance = HOVER_DISTANCE_PX;
        for (let i = range[0]; i <= range[1]; i++) {
          const p = track.points[i];
          v.set(p.x, p.alt, -p.y).project(camera);
          if (v.z > 1) continue;
          const d = Math.hypot(((v.x + 1) / 2) * rect.width - (e.clientX - rect.left), ((1 - v.y) / 2) * rect.height - (e.clientY - rect.top));
          if (d < bestDistance) {
            best = i;
            bestDistance = d;
          }
        }
        onHover(best);
      });
    };
    const onPointerDown = () => {
      controls.enableZoom = true;
    };
    const onPointerLeave = () => {
      cancelAnimationFrame(frame);
      controls.enableZoom = false;
      latest.current.onHover(null);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      for (const g of [ground, trackGroup, hoverGroup]) clearGroup(g);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  // Frames the shown part of the track, seen from the south-west and above.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const box = new THREE.Box3();
    for (let i = range[0]; i <= range[1]; i++) box.expandByPoint(toVector(track.points[i]));
    box.expandByPoint(new THREE.Vector3(box.min.x, 0, box.min.z));
    const center = box.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(-0.5, 0.45, 1).normalize();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (k) => new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z),
    );
    // Moves the camera until the box's corners just fit on screen; a few rounds get close enough.
    let distance = Math.max(box.getSize(new THREE.Vector3()).length(), 100) * 2;
    s.camera.lookAt(center);
    for (let round = 0; round < 6; round++) {
      s.camera.position.copy(center).addScaledVector(direction, distance);
      s.camera.lookAt(center);
      s.camera.near = distance / 1000;
      s.camera.far = distance * 20;
      s.camera.updateProjectionMatrix();
      s.camera.updateMatrixWorld();
      const extent = Math.max(...corners.map((c) => c.clone().project(s.camera)).map((v) => Math.max(Math.abs(v.x), Math.abs(v.y))));
      distance *= extent / FILL;
    }
    s.controls.target.copy(center);
    s.controls.update();
  }, [track, range]);

  // The ground: map tiles around the shown part of the track.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    let cancelled = false;
    const points = track.points.slice(range[0], range[1] + 1);
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
    // Degrees per metre, to pad the box by a distance.
    const latPerM = 1 / 111_320;
    const lonPerM = latPerM / Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const sizeM = Math.max((maxLat - minLat) / latPerM, (maxLon - minLon) / lonPerM);
    const heightM = Math.max(...points.map((p) => p.alt));
    const pad = Math.max(Math.max(sizeM, heightM) * GROUND_MARGIN, (MIN_GROUND_SIZE - sizeM) / 2, 0);

    let z = MAX_TILE_ZOOM;
    let tiles: { x0: number; x1: number; y0: number; y1: number };
    for (;;) {
      const nw = tileAt(maxLat + pad * latPerM, minLon - pad * lonPerM, z);
      const se = tileAt(minLat - pad * latPerM, maxLon + pad * lonPerM, z);
      tiles = { x0: Math.floor(nw.x), x1: Math.floor(se.x), y0: Math.floor(nw.y), y1: Math.floor(se.y) };
      if ((tiles.x1 - tiles.x0 + 1) * (tiles.y1 - tiles.y0 + 1) <= MAX_TILES || z === 1) break;
      z--;
    }

    const loader = new THREE.TextureLoader();
    for (let x = tiles.x0; x <= tiles.x1; x++) {
      for (let y = tiles.y0; y <= tiles.y1; y++) {
        const nw = tileCorner(x, y, z);
        const se = tileCorner(x + 1, y + 1, z);
        const a = localXY(track.origin, nw.lat, nw.lon);
        const b = localXY(track.origin, se.lat, se.lon);
        const material = new THREE.MeshBasicMaterial({ color: '#f1f5f9' });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.x - a.x, a.y - b.y), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((a.x + b.x) / 2, 0, -(a.y + b.y) / 2);
        s.ground.add(mesh);
        loader.load(tileUrl(layer, z, x, y), (texture) => {
          if (cancelled) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
          material.map = texture;
          material.color.set('#ffffff');
          material.needsUpdate = true;
        });
      }
    }
    return () => {
      cancelled = true;
      clearGroup(s.ground);
    };
  }, [track, range, layer]);

  // The track, its markers and its projection onto the ground.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { points, jump } = track;
    const [a, b] = range;
    const { clientWidth: w, clientHeight: h } = containerRef.current!;
    const fatLine = (positions: number[], colors: number[], width: number) => {
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      geometry.setColors(colors);
      const material = new LineMaterial({ vertexColors: true, linewidth: width });
      material.resolution.set(w, h);
      s.lineMaterials.add(material);
      return new Line2(geometry, material);
    };
    const color = new THREE.Color();

    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = a; i <= b; i++) {
      positions.push(...toVector(points[i]).toArray());
      colors.push(...color.set(PHASE_COLORS[points[i].phase]).toArray());
    }
    s.trackGroup.add(fatLine(positions, colors, 3));

    if (projection) {
      const shadow = new THREE.BufferGeometry().setFromPoints(points.slice(a, b + 1).map((p) => toVector(p, 0.5)));
      s.trackGroup.add(new THREE.Line(shadow, new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.45 })));
      const drops: THREE.Vector3[] = [];
      const dropColors: number[] = [];
      let next = points[a].time;
      for (let i = a; i <= b; i++) {
        if (points[i].time < next) continue;
        next = points[i].time + dropInterval * 1000;
        drops.push(toVector(points[i]), toVector(points[i], 0));
        color.set(PHASE_COLORS[points[i].phase]);
        dropColors.push(...color.toArray(), ...color.toArray());
      }
      const dropGeometry = new THREE.BufferGeometry().setFromPoints(drops);
      dropGeometry.setAttribute('color', new THREE.Float32BufferAttribute(dropColors, 3));
      s.trackGroup.add(new THREE.LineSegments(dropGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 })));
    }

    if (jump) {
      const markers: [number, string][] = [
        [jump.exit, PHASE_COLORS.freefall],
        [jump.openingStart, PHASE_COLORS.opening],
        [jump.landing, PHASE_COLORS.canopy],
      ];
      for (const [i, markerColor] of markers) {
        if (i < a || i > b) continue;
        const marker = dot(markerColor, 16, h);
        marker.position.copy(toVector(points[i]));
        s.trackGroup.add(marker);
      }
    }

    return () => {
      s.trackGroup.traverse((o) => {
        if (o instanceof Line2) s.lineMaterials.delete(o.material);
      });
      clearGroup(s.trackGroup);
    };
  }, [track, range, projection, dropInterval]);

  // The hovered point, with a line down to the ground.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    clearGroup(s.hoverGroup);
    const p = hover == null ? undefined : track.points[hover];
    if (!p) return;
    const marker = dot('#ffffff', 18, containerRef.current!.clientHeight);
    marker.position.copy(toVector(p));
    const drop = new THREE.BufferGeometry().setFromPoints([toVector(p), toVector(p, 0)]);
    s.hoverGroup.add(marker, new THREE.Line(drop, new THREE.LineBasicMaterial({ color: '#0f172a' })));
  }, [track, hover]);

  // Fills the window rather than using the Fullscreen API, which iPhones and embedded browsers lack.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);

  if (error) return <p className="p-4 text-sm text-slate-500">{error}</p>;

  return (
    <div className={`overflow-hidden bg-slate-200 ${fullscreen ? 'fixed inset-0 z-50' : 'relative h-full min-h-72 w-full rounded-lg'}`}>
      <div ref={containerRef} className="absolute inset-0" />
      <button
        type="button"
        className="absolute top-2 right-2 cursor-pointer rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow hover:bg-white"
        onClick={() => setFullscreen(!fullscreen)}
      >
        {fullscreen ? 'Close' : 'Fullscreen'}
      </button>
      {/* Mouse instructions, so only on screens big enough to have a mouse. */}
      <p className="pointer-events-none absolute top-2 left-2 hidden rounded-md sm:block bg-white/80 px-2 py-1 text-xs text-slate-600">
        Drag to turn · right-drag to move · click, then scroll to zoom
      </p>
      <div className="absolute right-2 bottom-2 left-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex rounded-lg bg-white/90 p-0.5 shadow" role="group" aria-label="Ground">
          {(Object.keys(TILE_LAYERS) as TileLayer[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layer === l}
              className={`cursor-pointer rounded-md px-2.5 py-0.5 text-xs font-medium ${layer === l ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setLayer(l)}
            >
              {TILE_LAYERS[l].label}
            </button>
          ))}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1 text-xs shadow">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={projection} onChange={(e) => setProjection(e.target.checked)} className="accent-sky-600" />
              Projection
            </label>
            <input
              type="range"
              aria-label="Seconds between lines to the ground"
              min={1}
              max={30}
              value={dropInterval}
              disabled={!projection}
              onChange={(e) => setDropInterval(Number(e.target.value))}
              className="w-24 accent-sky-600 disabled:opacity-50"
            />
            <span className="w-7 tabular-nums text-slate-500">{dropInterval} s</span>
          </div>
          <span className="rounded bg-white/80 px-1.5 text-[10px] text-slate-600">{TILE_LAYERS[layer].credit}</span>
        </div>
      </div>
    </div>
  );
}
