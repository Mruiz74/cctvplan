import DxfParser from 'dxf-parser'

// $INSUNITS del DXF → metros por unidad de dibujo.
const UNIT_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 8: 0.0000254, 13: 0.000001, 14: 0.01, 15: 1, 16: 1000 }

// Importa un DXF: extrae líneas/polilíneas como muros, los encaja en un lienzo y
// (si el DXF trae unidades) calcula px/m para calibrar la escala automáticamente.
export function importarDXF(texto) {
  const parser = new DxfParser()
  const dxf = parser.parseSync(texto)
  const segs = []
  const push = (a, b) => { if (a && b && isFinite(a.x) && isFinite(b.x)) segs.push([a.x, a.y, b.x, b.y]) }
  for (const e of (dxf.entities || [])) {
    const v = e.vertices || []
    if (e.type === 'LINE' && v.length >= 2) push(v[0], v[1])
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && v.length >= 2) {
      for (let i = 0; i < v.length - 1; i++) push(v[i], v[i + 1])
      if (e.shape || e.closed) push(v[v.length - 1], v[0])
    }
  }
  if (!segs.length) throw new Error('El DXF no tiene líneas/polilíneas legibles (pueden estar en bloques o referencias externas).')

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of segs) for (const p of [[s[0], s[1]], [s[2], s[3]]]) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
  }
  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1
  const scale = 1600 / Math.max(bw, bh) // px por unidad DXF
  const W = Math.max(1, Math.round(bw * scale)), H = Math.max(1, Math.round(bh * scale))

  const walls = segs.map(([x1, y1, x2, y2]) => ({
    x1: (x1 - minX) * scale, y1: (maxY - y1) * scale, // se invierte Y (DXF: Y hacia arriba)
    x2: (x2 - minX) * scale, y2: (maxY - y2) * scale,
  }))

  const insunits = dxf.header && dxf.header['$INSUNITS']
  const mPorUnidad = UNIT_M[insunits]
  const pxPerMeter = mPorUnidad ? scale / mPorUnidad : null

  return { walls, w: W, h: H, pxPerMeter }
}
