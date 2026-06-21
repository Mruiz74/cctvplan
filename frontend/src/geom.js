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
