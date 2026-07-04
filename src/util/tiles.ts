// Web-Mercator tile math for caching/serving the overview route map offline.
// Tiles are keyed z/x/y so the same tile is stored once no matter how many legs use it.
export const GEOAPIFY_KEY = '35cc051d3e9440919ed8c6a1ffdfd7ae';
export const GEOAPIFY_TILE_TEMPLATE =
  `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}&lang=en`;
export const geoapifyTileUrl = (z: number, x: number, y: number) =>
  `https://maps.geoapify.com/v1/tile/osm-bright/${z}/${x}/${y}.png?apiKey=${GEOAPIFY_KEY}&lang=en`;

export type Tile = { z: number; x: number; y: number };
export const tileKey = (t: Tile) => `${t.z}/${t.x}/${t.y}`;

export const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2tile = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// The overview zoom that frames a dep→arr route (bbox fits in ≤4 tiles each way), and the
// tiles covering it with a 1-tile pad. Deterministic, so overlapping legs share tile keys.
export function overviewTiles(depLat: number, depLon: number, arrLat: number, arrLon: number): { z: number; tiles: Tile[] } {
  let minLat = Math.min(depLat, arrLat), maxLat = Math.max(depLat, arrLat);
  let minLon = Math.min(depLon, arrLon), maxLon = Math.max(depLon, arrLon);
  const padLat = (maxLat - minLat) * 0.2 + 0.6, padLon = (maxLon - minLon) * 0.2 + 0.6;
  minLat = Math.max(minLat - padLat, -85); maxLat = Math.min(maxLat + padLat, 85);
  minLon -= padLon; maxLon += padLon;
  let z = 3;
  for (let zz = 8; zz >= 2; zz--) {
    const xs = lon2tile(maxLon, zz) - lon2tile(minLon, zz);
    const ys = lat2tile(minLat, zz) - lat2tile(maxLat, zz);   // south → larger y
    if (xs <= 4 && ys <= 4) { z = zz; break; }
  }
  const max = 2 ** z;
  const x0 = lon2tile(minLon, z) - 1, x1 = lon2tile(maxLon, z) + 1;
  const y0 = lat2tile(maxLat, z) - 1, y1 = lat2tile(minLat, z) + 1;
  const tiles: Tile[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    tiles.push({ z, x: ((x % max) + max) % max, y: Math.max(0, Math.min(max - 1, y)) });
  }
  return { z, tiles };
}
