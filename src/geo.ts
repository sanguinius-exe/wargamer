// Small spherical-earth helpers shared by fog of war and the ruler.

type Pt = { lng: number; lat: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: Pt, b: Pt): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, 0-360 degrees. */
export function bearingDeg(a: Pt, b: Pt): number {
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** "12.4 km · 6.7 nmi", or metres when short. */
export function fmtDistance(m: number): string {
  const nmi = m / 1852;
  const km = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} km`;
  return `${km} · ${nmi.toFixed(nmi < 100 ? 1 : 0)} nmi`;
}
