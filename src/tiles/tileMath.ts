// Web-Mercator (XYZ) tile maths.

export interface TileId {
  z: number;
  x: number;
  y: number;
}

const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  );
}

/** All tiles covering [w,s,e,n] across [minZoom..maxZoom]. */
export function tilesForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): TileId[] {
  const [w, s, e, n] = bounds;
  const out: TileId[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z - 1;
    const x0 = Math.max(0, Math.floor(lngToTileX(w, z)));
    const x1 = Math.min(max, Math.floor(lngToTileX(e, z)));
    const y0 = Math.max(0, Math.floor(latToTileY(n, z)));
    const y1 = Math.min(max, Math.floor(latToTileY(s, z)));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) out.push({ z, x, y });
    }
  }
  return out;
}

export function countTilesForBounds(
  bounds: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): number {
  const [w, s, e, n] = bounds;
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z - 1;
    const x0 = Math.max(0, Math.floor(lngToTileX(w, z)));
    const x1 = Math.min(max, Math.floor(lngToTileX(e, z)));
    const y0 = Math.max(0, Math.floor(latToTileY(n, z)));
    const y1 = Math.min(max, Math.floor(latToTileY(s, z)));
    total += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return total;
}

export const tileKey = (layer: string, t: TileId): string =>
  `${layer}/${t.z}/${t.x}/${t.y}`;
