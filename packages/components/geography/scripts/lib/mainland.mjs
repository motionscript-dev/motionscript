// Where the generic distance rule below gets a well-known country wrong: the
// lon/lat box its mainland sits in ([west, south, east, north]). A part whose
// centroid is outside is remote. Alaska is the reason this table exists — it is
// both large and close to the lower 48.
const MAINLAND_BOX = {
  US: [-130, 23, -60, 50],
  FR: [-6, 41, 10, 52],
  NZ: [165, -48, 179, -34],
  EC: [-82, -6, -75, 2],
  ES: [-10, 35, 5, 44.5],
  PT: [-10, 36, -6, 43],
  NO: [4, 57, 32, 72],
  CL: [-76, -56.5, -66, -17],
  NL: [3, 50, 8, 54],
  CO: [-80, -5, -66, 13.5],
  YE: [42, 12, 54, 19],
  AU: [112, -44, 154, -9],
  ZA: [16, -35, 33, -22],
  JP: [122, 24, 146, 46],
}

const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180

function lonGap([w0, e0], [w1, e1]) {
  const width = (w, e) => (e >= w ? e - w : e + 360 - w)
  const inside = (lon, w, e) => {
    const d = wrap(lon - w)
    return (d >= 0 ? d : d + 360) <= width(w, e)
  }
  if (inside(w1, w0, e0) || inside(w0, w1, e1)) return 0
  const d1 = wrap(w1 - e0)
  const d2 = wrap(w0 - e1)
  return Math.min(d1 < 0 ? d1 + 360 : d1, d2 < 0 ? d2 + 360 : d2)
}

/** Angular gap between two `geoBounds` boxes, longitude scaled at their latitude. */
export function boundsGap(a, b) {
  const [[aw, as], [ae, an]] = a
  const [[bw, bs], [be, bn]] = b
  const latGap = Math.max(0, bs - an, as - bn)
  const midLat = ((Math.max(as, bs) + Math.min(an, bn)) / 2) * (Math.PI / 180)
  const lon = lonGap([aw, ae], [bw, be]) * Math.max(0.2, Math.cos(midLat))
  return Math.hypot(lon, latGap)
}

export function boundsDiagonal([[w, s], [e, n]]) {
  const width = e >= w ? e - w : e + 360 - w
  const midLat = ((s + n) / 2) * (Math.PI / 180)
  return Math.hypot(width * Math.max(0.2, Math.cos(midLat)), n - s)
}

/**
 * Indices of the parts that make up a region's mainland, or `null` when every
 * part does. `parts` carry `area` (steradians), `bounds` and `centroid`.
 *
 * A part is mainland when it is large relative to the largest part, or near
 * it: within three quarters of the largest part's diagonal.
 */
export function mainlandParts(code, parts) {
  if (parts.length <= 1) return null
  const box = MAINLAND_BOX[code]
  let keep
  if (box) {
    const [west, south, east, north] = box
    keep = parts.map(({ centroid: [lon, lat] }) => lon >= west && lon <= east && lat >= south && lat <= north)
  } else {
    const largest = parts.reduce((a, b) => (b.area > a.area ? b : a))
    const reach = Math.max(2, 0.75 * boundsDiagonal(largest.bounds))
    keep = parts.map(
      (part) => part === largest || part.area >= 0.1 * largest.area || boundsGap(part.bounds, largest.bounds) <= reach
    )
  }
  if (!keep.some(Boolean)) {
    const largest = parts.indexOf(parts.reduce((a, b) => (b.area > a.area ? b : a)))
    keep[largest] = true
  }
  return keep.every(Boolean) ? null : keep.flatMap((k, i) => (k ? [i] : []))
}

export function boundsIntersect(a, b, tolerance = 0.5) {
  const [[aw, as], [ae, an]] = a
  const [[bw, bs], [be, bn]] = b
  if (as > bn + tolerance || bs > an + tolerance) return false
  return lonGap([aw, ae], [bw, be]) <= tolerance
}
