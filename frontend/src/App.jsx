import { useEffect, useRef, useState } from 'react'
import catalogo from './data/camaras.json'
import { coberturaCamara } from './lib/coverage'
import { sectorPath, dist, clamp } from './geom'

const CAMS = catalogo.camaras
const catById = (id) => CAMS.find((c) => c.id === id)
const MARCAS = [...new Set(CAMS.map((c) => c.marca))]

// Colores de las bandas DORI (de menor a mayor exigencia).
const BANDAS = [
  { key: 'detectar', label: 'Detectar', fill: 'rgba(239,68,68,0.12)' },
  { key: 'observar', label: 'Observar', fill: 'rgba(245,158,11,0.16)' },
  { key: 'reconocer', label: 'Reconocer', fill: 'rgba(234,179,8,0.20)' },
  { key: 'identificar', label: 'Identificar', fill: 'rgba(34,197,94,0.30)' },
]

const STORE = 'cctvplan_project'
const nuevoProyecto = () => ({ bg: null, pxPerMeter: null, cameras: [], walls: [] })

export default function App() {
  const [proj, setProj] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE)) || nuevoProyecto() } catch { return nuevoProyecto() }
  })
  const [mode, setMode] = useState('select') // select | scale | wall | camera
  const [catSel, setCatSel] = useState(null) // id de cámara del catálogo a colocar
  const [sel, setSel] = useState(null) // id de cámara colocada seleccionada
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0 })
  const [scalePts, setScalePts] = useState([])
  const [wallStart, setWallStart] = useState(null)
  const [marca, setMarca] = useState(MARCAS[0])
  const svgRef = useRef(null)
  const drag = useRef(null)

  // Persistencia
  useEffect(() => { localStorage.setItem(STORE, JSON.stringify(proj)) }, [proj])

  // Zoom con la rueda (centrado en el cursor)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      setView((v) => {
        const f = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const nz = clamp(v.zoom * f, 0.05, 30)
        return { zoom: nz, tx: sx - ((sx - v.tx) / v.zoom) * nz, ty: sy - ((sy - v.ty) / v.zoom) * nz }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toWorld = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: (clientX - r.left - view.tx) / view.zoom, y: (clientY - r.top - view.ty) / view.zoom }
  }

  const set = (patch) => setProj((p) => ({ ...p, ...patch }))

  // ─── Fondo (plano) ───────────────────────────────────────────────────────
  const subirPlano = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        set({ bg: { url: reader.result, w: img.naturalWidth, h: img.naturalHeight } })
        // Encajar en la vista
        const r = svgRef.current.getBoundingClientRect()
        const z = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) * 0.9
        setView({ zoom: z, tx: (r.width - img.naturalWidth * z) / 2, ty: (r.height - img.naturalHeight * z) / 2 })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  // ─── Interacción en el lienzo ──────────────────────────────────────────────
  const onPointerDown = (e) => {
    const w = toWorld(e.clientX, e.clientY)

    if (mode === 'camera' && catSel) {
      const id = 'c' + Date.now()
      set({ cameras: [...proj.cameras, { id, catId: catSel, lenteIdx: 0, x: w.x, y: w.y, rot: 0 }] })
      setSel(id); setMode('select')
      return
    }
    if (mode === 'scale') {
      const pts = [...scalePts, w]
      if (pts.length === 2) {
        const px = dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y)
        const m = parseFloat(prompt('¿Cuántos METROS mide esa distancia en la realidad?', '5'))
        if (m > 0) set({ pxPerMeter: px / m })
        setScalePts([]); setMode('select')
      } else setScalePts(pts)
      return
    }
    if (mode === 'wall') {
      if (!wallStart) setWallStart(w)
      else { set({ walls: [...proj.walls, { x1: wallStart.x, y1: wallStart.y, x2: w.x, y2: w.y }] }); setWallStart(w) }
      return
    }
    // modo select → paneo
    setSel(null)
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    if (d.type === 'pan') setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy) }))
    else if (d.type === 'cam') {
      const w = toWorld(e.clientX, e.clientY)
      setProj((p) => ({ ...p, cameras: p.cameras.map((c) => (c.id === d.id ? { ...c, x: w.x - d.ox, y: w.y - d.oy } : c)) }))
    }
  }
  const onUp = () => {
    drag.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  const onCamDown = (e, cam) => {
    e.stopPropagation()
    if (mode !== 'select') return
    setSel(cam.id)
    const w = toWorld(e.clientX, e.clientY)
    drag.current = { type: 'cam', id: cam.id, ox: w.x - cam.x, oy: w.y - cam.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const updCam = (id, patch) => setProj((p) => ({ ...p, cameras: p.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const delCam = (id) => { setProj((p) => ({ ...p, cameras: p.cameras.filter((c) => c.id !== id) })); setSel(null) }

  const camSel = proj.cameras.find((c) => c.id === sel)
  const ppm = proj.pxPerMeter || 40 // fallback visual si no hay escala

  return (
    <div className="app">
      <header className="bar">
        <span className="logo">🎥 CCTVPLAN</span>
        <label className="btn"><input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => subirPlano(e.target.files[0])} />📐 Subir plano</label>
        <button className={'btn ' + (mode === 'scale' ? 'on' : '')} onClick={() => { setMode('scale'); setScalePts([]) }}>📏 Escala</button>
        <button className={'btn ' + (mode === 'wall' ? 'on' : '')} onClick={() => { setMode(mode === 'wall' ? 'select' : 'wall'); setWallStart(null) }}>🧱 Muro</button>
        <button className={'btn ' + (mode === 'select' ? 'on' : '')} onClick={() => setMode('select')}>🖐️ Mover</button>
        <div className="spacer" />
        <span className="escala">{proj.pxPerMeter ? `Escala: ${proj.pxPerMeter.toFixed(1)} px/m ✓` : '⚠️ Escala sin calibrar'}</span>
        <button className="btn" onClick={() => { if (confirm('¿Vaciar el proyecto?')) { setProj(nuevoProyecto()); setSel(null) } }}>🗑️</button>
      </header>

      <div className="layout">
        <aside className="side">
          <h3 className="sec">Cámaras</h3>
          <select className="in" value={marca} onChange={(e) => setMarca(e.target.value)}>
            {MARCAS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <div className="cat">
            {CAMS.filter((c) => c.marca === marca).map((c) => (
              <button key={c.id} className={'cat-item ' + (catSel === c.id ? 'on' : '')}
                onClick={() => { setCatSel(c.id); setMode('camera') }}>
                <b>{c.modelo}</b><span>{c.mp ? c.mp + 'MP · ' : ''}{c.tipo}</span>
              </button>
            ))}
          </div>
          {mode === 'camera' && <div className="hint">Toca el plano para colocar la cámara 📍</div>}

          {camSel && <CamProps cam={camSel} cat={catById(camSel.catId)} onUpd={updCam} onDel={delCam} />}
        </aside>

        <main className="canvas">
          <svg ref={svgRef} className="svg" onPointerDown={onPointerDown}>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.zoom})`}>
              {proj.bg && <image href={proj.bg.url} x={0} y={0} width={proj.bg.w} height={proj.bg.h} />}
              {!proj.bg && <text x={20} y={40} fill="#5b6b86" fontSize={18}>Sube un plano para empezar →</text>}

              {proj.walls.map((w, i) => (
                <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#e2e8f0" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              ))}
              {wallStart && <circle cx={wallStart.x} cy={wallStart.y} r={4} fill="#0ea5e9" vectorEffect="non-scaling-stroke" />}
              {scalePts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="#22c55e" vectorEffect="non-scaling-stroke" />)}

              {proj.cameras.map((cam) => (
                <CamView key={cam.id} cam={cam} cat={catById(cam.catId)} ppm={ppm} sel={sel === cam.id} onDown={onCamDown} />
              ))}
            </g>
          </svg>

          {/* Leyenda DORI */}
          <div className="legend">
            {BANDAS.slice().reverse().map((b) => (
              <span key={b.key}><i style={{ background: b.fill }} />{b.label}</span>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

// Cámara + conos DORI en el lienzo
function CamView({ cam, cat, ppm, sel, onDown }) {
  if (!cat) return null
  const cov = coberturaCamara(cat, cam.lenteIdx)
  const a1 = cam.rot - cov.hfov / 2
  const a2 = cam.rot + cov.hfov / 2
  return (
    <g onPointerDown={(e) => onDown(e, cam)} style={{ cursor: 'move' }}>
      {BANDAS.map((b) => {
        const r = cov.dori[b.key] * ppm
        return <path key={b.key} d={sectorPath(cam.x, cam.y, r, a1, a2)} fill={b.fill} stroke="none" />
      })}
      <circle cx={cam.x} cy={cam.y} r={7} fill={sel ? '#0ea5e9' : '#111827'} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </g>
  )
}

// Panel de propiedades de la cámara seleccionada
function CamProps({ cam, cat, onUpd, onDel }) {
  if (!cat) return null
  const cov = coberturaCamara(cat, cam.lenteIdx)
  return (
    <div className="props">
      <h3 className="sec">{cat.marca} {cat.modelo}</h3>
      <div className="muted">{cat.mp ? cat.mp + 'MP' : ''} · {cat.tipo}</div>

      <label className="lbl">Lente / focal</label>
      <select className="in" value={cam.lenteIdx} onChange={(e) => onUpd(cam.id, { lenteIdx: +e.target.value })}>
        {(cat.lentes || []).map((l, i) => (
          <option key={i} value={i}>{l.focal_mm}mm {l.hfov_publicado_deg ? `(${l.hfov_publicado_deg}°)` : '(est.)'}</option>
        ))}
      </select>

      <label className="lbl">Rotación: {cam.rot}°</label>
      <input className="range" type="range" min={0} max={359} value={cam.rot} onChange={(e) => onUpd(cam.id, { rot: +e.target.value })} />

      <div className="dori">
        <div><b>Cobertura DORI</b> (HFOV {cov.hfov}°{cov.estimado ? ' est.' : ''})</div>
        <div className="d-row"><span className="d id">Identificar</span><b>{cov.dori.identificar} m</b></div>
        <div className="d-row"><span className="d re">Reconocer</span><b>{cov.dori.reconocer} m</b></div>
        <div className="d-row"><span className="d ob">Observar</span><b>{cov.dori.observar} m</b></div>
        <div className="d-row"><span className="d de">Detectar</span><b>{cov.dori.detectar} m</b></div>
      </div>

      <button className="btn danger" onClick={() => onDel(cam.id)}>🗑️ Eliminar cámara</button>
    </div>
  )
}
