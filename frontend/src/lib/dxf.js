import DxfParser from 'dxf-parser'

// $INSUNITS del DXF → metros por unidad de dibujo.
const UNIT_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 8: 0.0000254, 13: 0.000001, 14: 0.01, 15: 1, 16: 1000 }

// Parsea un DXF: devuelve los segmentos (ya transformados al lienzo, con su capa),
// la lista de capas con conteo, el tamaño del lienzo y px/m (si el DXF trae unidades).
export function parseDXF(texto) {
  const parser = new DxfParser()
  const dxf = parser.parseSync(texto)
  const raw = []
  const add = (a, b, L) => { if (a && b && isFinite(a.x) && isFinite(b.x)) raw.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer: L || '0' }) }
  for (const e of (dxf.entities || [])) {
    const v = e.vertices || []; const L = e.layer || '0'
    if (e.type === 'LINE' && v.length >= 2) add(v[0], v[1], L)
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && v.length >= 2) {
      for (let i = 0; i < v.length - 1; i++) add(v[i], v[i + 1], L)
      if (e.shape || e.closed) add(v[v.length - 1], v[0], L)
    }
  }
  if (!raw.length) throw new Error('El DXF no tiene líneas/polilíneas legibles (pueden estar en bloques o referencias externas).')

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of raw) for (const p of [[s.x1, s.y1], [s.x2, s.y2]]) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
  }
  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1
  const scale = 1600 / Math.max(bw, bh)
  const W = Math.max(1, Math.round(bw * scale)), H = Math.max(1, Math.round(bh * scale))

  const segs = raw.map((s) => ({
    x1: (s.x1 - minX) * scale, y1: (maxY - s.y1) * scale,
    x2: (s.x2 - minX) * scale, y2: (maxY - s.y2) * scale, layer: s.layer,
  }))

  const lc = {}; for (const s of segs) lc[s.layer] = (lc[s.layer] || 0) + 1
  const layers = Object.entries(lc).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

  const insunits = dxf.header && dxf.header['$INSUNITS']
  const mPorUnidad = UNIT_M[insunits]
  const pxPerMeter = mPorUnidad ? scale / mPorUnidad : null

  return { segs, layers, w: W, h: H, pxPerMeter }
}
