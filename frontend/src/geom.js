export const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

// Path SVG de un sector circular: centro (cx,cy), radio r, de a1 a a2 (grados).
export function sectorPath(cx, cy, r, a1, a2) {
  if (r <= 0) return ''
  const s = polar(cx, cy, r, a1)
  const e = polar(cx, cy, r, a2)
  const large = Math.abs(a2 - a1) % 360 > 180 ? 1 : 0
  return `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)} Z`
}

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1)
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// Intersección rayo (origen O, dirección unitaria D) con segmento (P1,P2).
// Devuelve la distancia t a lo largo del rayo, o null si no corta.
function raySeg(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1
  const denom = dx * sy - dy * sx
  if (Math.abs(denom) < 1e-9) return null
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom
  if (t >= 0 && u >= 0 && u <= 1) return t
  return null
}

// Polígono de visibilidad de una cámara: desde (cx,cy), abanico de a1 a a2 (grados),
// alcance máx maxR, cortado por los muros. Devuelve puntos para un clipPath.
export function visibilityPolygon(cx, cy, a1, a2, maxR, walls, steps = 64) {
  const pts = [{ x: cx, y: cy }]
  const n = Math.max(12, steps)
  for (let i = 0; i <= n; i++) {
    const ang = (a1 + ((a2 - a1) * i) / n) * Math.PI / 180
    const dx = Math.cos(ang), dy = Math.sin(ang)
    let best = maxR
    for (const w of walls) {
      const t = raySeg(cx, cy, dx, dy, w.x1, w.y1, w.x2, w.y2)
      if (t != null && t > 0.5 && t < best) best = t
    }
    pts.push({ x: cx + dx * best, y: cy + dy * best })
  }
  return pts
}
