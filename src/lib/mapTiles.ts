/** Map tile sources shared by the track viewer's 2D map and 3D view. */
export const TILE_LAYERS = {
  map: {
    label: 'Map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    credit: '© OpenStreetMap contributors',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
};
export type TileLayer = keyof typeof TILE_LAYERS;

export function tileUrl(layer: TileLayer, z: number, x: number, y: number) {
  return TILE_LAYERS[layer].url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** The Web Mercator tile containing a point, as fractional tile coordinates at zoom `z`. */
export function tileAt(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/** The latitude and longitude of a tile's top-left corner (tile coordinates at zoom `z`). */
export function tileCorner(x: number, y: number, z: number) {
  const n = 2 ** z;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    lon: (x / n) * 360 - 180,
  };
}
