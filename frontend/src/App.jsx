import { useEffect, useRef, useState } from 'react'
import catalogo from './data/camaras.json'
import dispositivos from './data/dispositivos.json'
import { coberturaCamara } from './lib/coverage'
import { sectorPath, dist, clamp, visibilityPolygon } from './geom'
import { abrirPropuesta } from './proposal'

const CAMS = catalogo.camaras
const DEVS = dispositivos.dispositivos
const catById = (id) => CAMS.find((c) => c.id === id)
const devById = (id) => DEVS.find((d) => d.id === id)
const MARCAS = [...new Set(CAMS.map((c) => c.marca))]
export const clp = (n) => '$' + (Math.round(Number(n) || 0)).toLocaleString('es-CL')
const API_IA = 'https://cctvplan-api.onrender.com' // backend de IA (auto-diseño)

// Coloca una cámara en un recinto propuesto por la IA: en una esquina, mirando al
// centro, eligiendo la lente cuyo alcance (al nivel pedido) calce con el recinto.
function colocarDeZona(zona, bg, ppm) {
  const cat = catById(zona.modelo_id)
  if (!cat || !(cat.lentes && cat.lentes.length)) return null
  const x = (zona.x || 0) * bg.w, y = (zona.y || 0) * bg.h
  const w = Math.max((zona.w || 0) * bg.w, 4), h = Math.max((zona.h || 0) * bg.h, 4)
  const cx = x + w / 2, cy = y + h / 2
  const corner = { x: x + w * 0.08, y: y + h * 0.08 }
  const rot = Math.round((((Math.atan2(cy - corner.y, cx - corner.x) * 180) / Math.PI) % 360 + 360) % 360)
  const diagM = ppm ? Math.hypot(w, h) / ppm : null
  const nivel = ['identificar', 'reconocer', 'observar', 'detectar'].includes(zona.nivel_dori) ? zona.nivel_dori : 'reconocer'
  let lenteIdx = 0
  if (diagM) {
    let mejor = Infinity
    cat.lentes.forEach((l, i) => {
      const alcance = coberturaCamara(cat, i).dori[nivel]
      const score = alcance >= diagM ? alcance - diagM : 1e6 + (diagM - alcance)
      if (score < mejor) { mejor = score; lenteIdx = i }
    })
  }
  return { id: 'ia' + Date.now() + Math.floor(Math.random() * 1e5), catId: zona.modelo_id, lenteIdx, x: corner.x, y: corner.y, rot }
}

const BANDAS = [
  { key: 'detectar', label: 'Detectar', fill: 'rgba(239,68,68,0.12)' },
  { key: 'observar', label: 'Observar', fill: 'rgba(245,158,11,0.16)' },
  { key: 'reconocer', label: 'Reconocer', fill: 'rgba(234,179,8,0.20)' },
  { key: 'identificar', label: 'Identificar', fill: 'rgba(34,197,94,0.30)' },
]

const STORE = 'cctvplan_project'
const nuevoProyecto = () => ({ nombre: 'Proyecto sin nombre', bg: null, pxPerMeter: null, cameras: [], devices: [], walls: [], cables: [], precios: {}, precioCableM: 0 })

export default function App() {
  const [proj, setProj] = useState(() => {
    try { return { ...nuevoProyecto(), ...JSON.parse(localStorage.getItem(STORE)) } } catch { return nuevoProyecto() }
  })
  const [mode, setMode] = useState('select') // select | scale | wall | cable | camera | device
  const [catTab, setCatTab] = useState('camaras')
  const [catSel, setCatSel] = useState(null)
  const [devSel, setDevSel] = useState(null)
  const [sel, setSel] = useState(null) // { kind:'cam'|'dev', id }
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0 })
  const [scalePts, setScalePts] = useState([])
  const [lineStart, setLineStart] = useState(null) // muro o cable en curso
  const [marca, setMarca] = useState(MARCAS[0])
  const [autoPts, setAutoPts] = useState([])
  const [autoNivel, setAutoNivel] = useState('reconocer')
  const [iaBrief, setIaBrief] = useState('')
  const [iaMarca, setIaMarca] = useState('auto')
  const [iaLoading, setIaLoading] = useState(false)
  const [iaResult, setIaResult] = useState(null)
  const [iaErr, setIaErr] = useState('')
  const [murosLoading, setMurosLoading] = useState(false)
  const svgRef = useRef(null)
  const drag = useRef(null)
  const projRef = useRef(proj)
  const hist = useRef({ past: [], future: [] })

  useEffect(() => {
    projRef.current = proj
    try { localStorage.setItem(STORE, JSON.stringify(proj)) }
    catch { /* plano muy grande para guardar local: el proyecto sigue en memoria */ }
  }, [proj])

  // Historial (deshacer/rehacer)
  const snapshot = () => { const h = hist.current; h.past.push(JSON.stringify(projRef.current)); if (h.past.length > 40) h.past.shift(); h.future = [] }
  const undo = () => { const h = hist.current; if (!h.past.length) return; h.future.push(JSON.stringify(projRef.current)); setProj(JSON.parse(h.past.pop())); setSel(null) }
  const redo = () => { const h = hist.current; if (!h.future.length) return; h.past.push(JSON.stringify(projRef.current)); setProj(JSON.parse(h.future.pop())); setSel(null) }

  useEffect(() => {
    const onKey = (e) => {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !editing) {
        snapshot()
        if (sel.kind === 'cam') setProj((p) => ({ ...p, cameras: p.cameras.filter((c) => c.id !== sel.id) }))
        else setProj((p) => ({ ...p, devices: p.devices.filter((d) => d.id !== sel.id) }))
        setSel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

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

  const toWorld = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: (cx - r.left - view.tx) / view.zoom, y: (cy - r.top - view.ty) / view.zoom }
  }
  const set = (patch) => setProj((p) => ({ ...p, ...patch }))

  const fitView = (bg = proj.bg) => {
    if (!bg || !svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const z = Math.min(r.width / bg.w, r.height / bg.h) * 0.9
    setView({ zoom: z, tx: (r.width - bg.w * z) / 2, ty: (r.height - bg.h * z) / 2 })
  }

  const subirPlano = async (file) => {
    if (!file) return
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      try {
        const buf = await file.arrayBuffer()
        const { pdfABackground } = await import('./lib/pdf') // se carga solo al usar PDF
        const bg = await pdfABackground(buf)
        set({ bg }); fitView(bg)
      } catch (e) { console.error(e); alert('No se pudo leer el PDF. Prueba con otra página o una imagen.') }
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => { const bg = { url: reader.result, w: img.naturalWidth, h: img.naturalHeight }; set({ bg }); fitView(bg) }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  const onPointerDown = (e) => {
    const w = toWorld(e.clientX, e.clientY)
    if (mode === 'camera' || mode === 'device' || mode === 'wall' || mode === 'cable' || (mode === 'scale' && scalePts.length === 1)) snapshot()
    if (mode === 'camera' && catSel) {
      const id = 'c' + Date.now()
      set({ cameras: [...proj.cameras, { id, catId: catSel, lenteIdx: 0, x: w.x, y: w.y, rot: 0 }] })
      setSel({ kind: 'cam', id }); setMode('select'); return
    }
    if (mode === 'device' && devSel) {
      const id = 'd' + Date.now()
      set({ devices: [...proj.devices, { id, devId: devSel, x: w.x, y: w.y }] })
      setSel({ kind: 'dev', id }); setMode('select'); return
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
    if (mode === 'wall' || mode === 'cable') {
      const arr = mode === 'wall' ? 'walls' : 'cables'
      if (!lineStart) setLineStart(w)
      else { set({ [arr]: [...proj[arr], { x1: lineStart.x, y1: lineStart.y, x2: w.x, y2: w.y }] }); setLineStart(w) }
      return
    }
    if (mode === 'auto') { setAutoPts((a) => [...a, w]); return }
    setSel(null)
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    if (d.type === 'pan') setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy) }))
    else if (d.type === 'cam') { const w = toWorld(e.clientX, e.clientY); setProj((p) => ({ ...p, cameras: p.cameras.map((c) => (c.id === d.id ? { ...c, x: w.x - d.ox, y: w.y - d.oy } : c)) })) }
    else if (d.type === 'dev') { const w = toWorld(e.clientX, e.clientY); setProj((p) => ({ ...p, devices: p.devices.map((c) => (c.id === d.id ? { ...c, x: w.x - d.ox, y: w.y - d.oy } : c)) })) }
  }
  const onUp = () => { drag.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }

  const startDrag = (e, kind, item) => {
    e.stopPropagation()
    if (mode !== 'select') return
    snapshot()
    setSel({ kind, id: item.id })
    const w = toWorld(e.clientX, e.clientY)
    drag.current = { type: kind, id: item.id, ox: w.x - item.x, oy: w.y - item.y }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  const updCam = (id, patch) => setProj((p) => ({ ...p, cameras: p.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const delSel = () => {
    if (!sel) return
    snapshot()
    if (sel.kind === 'cam') setProj((p) => ({ ...p, cameras: p.cameras.filter((c) => c.id !== sel.id) }))
    else setProj((p) => ({ ...p, devices: p.devices.filter((d) => d.id !== sel.id) }))
    setSel(null)
  }
  const deshacerLinea = (arr) => setProj((p) => ({ ...p, [arr]: p[arr].slice(0, -1) }))

  // Auto-diseño v1 (geométrico): coloca cámaras a lo largo de la línea dibujada,
  // espaciadas según el alcance del nivel DORI objetivo, mirando perpendicular.
  const generarAuto = () => {
    if (!proj.pxPerMeter) { alert('Primero calibra la escala (📏).'); return }
    if (autoPts.length < 2 || !catSel) { alert('Elige un modelo de cámara (arriba) y dibuja la línea a cubrir.'); return }
    const cov = coberturaCamara(catById(catSel), 0)
    const rangeM = cov.dori[autoNivel] || cov.dori.reconocer
    const spacing = Math.max(rangeM * proj.pxPerMeter, 20)
    const nuevas = []
    let acc = 0, nextAt = spacing / 2
    for (let i = 0; i < autoPts.length - 1; i++) {
      const a = autoPts[i], b = autoPts[i + 1]
      const segLen = dist(a.x, a.y, b.x, b.y)
      if (segLen < 1) continue
      const dx = (b.x - a.x) / segLen, dy = (b.y - a.y) / segLen
      const headDeg = (Math.atan2(-dx, dy) * 180) / Math.PI
      while (nextAt <= acc + segLen) {
        const t = nextAt - acc
        nuevas.push({ id: 'c' + Date.now() + Math.floor(Math.random() * 1e4), catId: catSel, lenteIdx: 0, x: a.x + dx * t, y: a.y + dy * t, rot: Math.round((headDeg + 360) % 360) })
        nextAt += spacing
      }
      acc += segLen
    }
    if (nuevas.length) { snapshot(); set({ cameras: [...proj.cameras, ...nuevas] }) }
    setAutoPts([]); setMode('select')
  }

  // Detección de murallas con IA: Claude lee el plano y devuelve los segmentos.
  const detectarMurosIA = async () => {
    if (!proj.bg) { alert('Sube un plano primero (📐).'); return }
    setMurosLoading(true)
    try {
      const r = await fetch(API_IA + '/api/muros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagenDataUrl: proj.bg.url }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error del servidor de IA')
      const nuevos = []
      for (const z of (data.recintos || [])) {
        const x = (z.x || 0) * proj.bg.w, y = (z.y || 0) * proj.bg.h
        const w = (z.w || 0) * proj.bg.w, h = (z.h || 0) * proj.bg.h
        if (w < 6 || h < 6) continue
        nuevos.push(
          { x1: x, y1: y, x2: x + w, y2: y },
          { x1: x + w, y1: y, x2: x + w, y2: y + h },
          { x1: x + w, y1: y + h, x2: x, y2: y + h },
          { x1: x, y1: y + h, x2: x, y2: y },
        )
      }
      if (nuevos.length) { snapshot(); set({ walls: [...proj.walls, ...nuevos] }) }
      else alert('La IA no detectó recintos claros. Prueba con un plano más nítido o dibuja los muros a mano.')
    } catch (e) { alert(e.message || 'No se pudo detectar las murallas') } finally { setMurosLoading(false) }
  }

  // Auto-diseño con IA (Claude). Manda el plano + encargo al backend y coloca lo propuesto.
  const disenarIA = async () => {
    if (!proj.bg) { alert('Sube un plano primero (📐).'); return }
    setIaErr(''); setIaResult(null); setIaLoading(true)
    try {
      const r = await fetch(API_IA + '/api/autodiseno', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagenDataUrl: proj.bg.url, brief: iaBrief, pxPerMeter: proj.pxPerMeter,
          planoW: proj.bg.w, planoH: proj.bg.h, marcaPreferida: iaMarca,
          muros: (proj.walls || []).map((w) => ({ x1: w.x1 / proj.bg.w, y1: w.y1 / proj.bg.h, x2: w.x2 / proj.bg.w, y2: w.y2 / proj.bg.h })),
          catalogo: CAMS.filter((c) => !c._es_serie),
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error del servidor de IA')
      const nuevas = (data.zonas || []).map((z) => colocarDeZona(z, proj.bg, proj.pxPerMeter)).filter(Boolean)
      if (nuevas.length) snapshot()
      setProj((p) => ({ ...p, cameras: [...p.cameras, ...nuevas] }))
      setIaResult({ resumen: data.resumen, equipos: data.equipos || [], n: nuevas.length })
      setMode('select')
    } catch (e) {
      setIaErr(e.message || 'No se pudo conectar con la IA')
    } finally { setIaLoading(false) }
  }

  const camSel = sel?.kind === 'cam' ? proj.cameras.find((c) => c.id === sel.id) : null
  const devSelObj = sel?.kind === 'dev' ? proj.devices.find((d) => d.id === sel.id) : null
  const ppm = proj.pxPerMeter || 40

  const cableM = proj.pxPerMeter ? proj.cables.reduce((s, c) => s + dist(c.x1, c.y1, c.x2, c.y2), 0) / proj.pxPerMeter : 0

  return (
    <div className="app">
      <header className="bar">
        <span className="logo">🎥 CCTVPLAN</span>
        <input className="proj-name" value={proj.nombre} onChange={(e) => set({ nombre: e.target.value })} />
        <label className="btn"><input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => subirPlano(e.target.files[0])} />📐 Plano</label>
        <button className={'btn ' + (mode === 'scale' ? 'on' : '')} onClick={() => { setMode('scale'); setScalePts([]) }}>📏 Escala</button>
        <button className={'btn ' + (mode === 'wall' ? 'on' : '')} onClick={() => { setMode(mode === 'wall' ? 'select' : 'wall'); setLineStart(null) }}>🧱 Muro</button>
        <button className="btn" disabled={murosLoading} onClick={detectarMurosIA} title="Detectar murallas con IA">{murosLoading ? '🪄…' : '🪄 Muros IA'}</button>
        <button className={'btn ' + (mode === 'cable' ? 'on' : '')} onClick={() => { setMode(mode === 'cable' ? 'select' : 'cable'); setLineStart(null) }}>🔗 Cable</button>
        {mode === 'wall' && <button className="btn" onClick={() => deshacerLinea('walls')}>↶</button>}
        {mode === 'cable' && <button className="btn" onClick={() => deshacerLinea('cables')}>↶</button>}
        <button className={'btn ' + (mode === 'select' ? 'on' : '')} onClick={() => setMode('select')}>🖐️</button>
        <button className={'btn ' + (mode === 'auto' ? 'on' : '')} onClick={() => { setMode('auto'); setAutoPts([]); setCatTab('camaras') }}>🤖 Auto</button>
        <button className="btn" onClick={() => fitView()}>🔍</button>
        <button className="btn" onClick={undo} title="Deshacer (Ctrl+Z)">↶</button>
        <button className="btn" onClick={redo} title="Rehacer (Ctrl+Y)">↷</button>
        <div className="spacer" />
        <span className="escala">{proj.pxPerMeter ? `${proj.pxPerMeter.toFixed(1)} px/m ✓` : '⚠️ sin escala'}</span>
        <button className="btn on" onClick={() => abrirPropuesta(buildBom(proj))}>📄 Propuesta</button>
        <button className="btn" onClick={() => { if (confirm('¿Nuevo proyecto? Se borra el actual.')) { snapshot(); setProj(nuevoProyecto()); setSel(null) } }}>✚</button>
      </header>

      <div className="layout">
        <aside className="side">
          <div className="tabs">
            <button className={catTab === 'camaras' ? 'tab on' : 'tab'} onClick={() => setCatTab('camaras')}>📷 Cámaras</button>
            <button className={catTab === 'dispositivos' ? 'tab on' : 'tab'} onClick={() => setCatTab('dispositivos')}>🗄️ Equipos</button>
          </div>

          {catTab === 'camaras' && <>
            <select className="in" value={marca} onChange={(e) => setMarca(e.target.value)}>{MARCAS.map((m) => <option key={m}>{m}</option>)}</select>
            <div className="cat">
              {CAMS.filter((c) => c.marca === marca).map((c) => (
                <button key={c.id} className={'cat-item ' + (catSel === c.id && (mode === 'camera' || mode === 'auto') ? 'on' : '')} onClick={() => { setCatSel(c.id); if (mode !== 'auto') setMode('camera') }}>
                  <b>{c.modelo}</b><span>{c.mp ? c.mp + 'MP · ' : ''}{c.tipo}</span>
                </button>
              ))}
            </div>
          </>}
          {catTab === 'dispositivos' && <div className="cat">
            {DEVS.map((d) => (
              <button key={d.id} className={'cat-item ' + (devSel === d.id && mode === 'device' ? 'on' : '')} onClick={() => { setDevSel(d.id); setMode('device') }}>
                <b>{d.icono} {d.modelo}</b><span>{d.tipo}</span>
              </button>
            ))}
          </div>}
          {(mode === 'camera' || mode === 'device') && <div className="hint">Toca el plano para colocar 📍</div>}

          {mode === 'auto' && (
            <div className="props">
              <h3 className="sec">🤖 Auto-diseño</h3>
              <div className="muted">1) Elige el modelo (lista de arriba). 2) Marca con clics la línea/perímetro a cubrir. 3) Generar.</div>
              <div className="muted">Modelo: <b>{catSel ? catById(catSel)?.modelo : '— elige uno —'}</b></div>
              <label className="lbl">Nivel objetivo</label>
              <select className="in" value={autoNivel} onChange={(e) => setAutoNivel(e.target.value)}>
                <option value="identificar">Identificar (máxima calidad, más cámaras)</option>
                <option value="reconocer">Reconocer</option>
                <option value="observar">Observar</option>
                <option value="detectar">Detectar (máximo alcance, menos cámaras)</option>
              </select>
              <button className="btn on" style={{ width: '100%' }} onClick={generarAuto}>✨ Generar (geométrico)</button>
              <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => { setAutoPts([]); setMode('select') }}>Cancelar</button>

              <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
                <h3 className="sec">🧠 Diseñar con IA (Claude)</h3>
                <div className="muted">Describe el sitio y qué priorizar. La IA mira tu plano y propone las cámaras.</div>
                <label className="lbl">Marca del sistema</label>
                <select className="in" value={iaMarca} onChange={(e) => setIaMarca(e.target.value)}>
                  <option value="auto">Una sola marca (la IA elige la mejor)</option>
                  {MARCAS.map((m) => <option key={m} value={m}>Solo {m}</option>)}
                  <option value="mezclar">Permitir mezclar marcas</option>
                </select>
                <textarea className="in" rows={3} placeholder="Ej: bodega con 2 accesos; prioriza la entrada y la oficina de caja" value={iaBrief} onChange={(e) => setIaBrief(e.target.value)} />
                {iaErr && <div className="err">{iaErr}</div>}
                <button className="btn on" style={{ width: '100%' }} disabled={iaLoading} onClick={disenarIA}>{iaLoading ? '🧠 Diseñando…' : '🧠 Diseñar con IA'}</button>
                <div className="muted" style={{ marginTop: 6 }}>La 1ª vez puede tardar ~1 min (el servidor de IA despierta).</div>
              </div>
            </div>
          )}

          {iaResult && (
            <div className="props">
              <h3 className="sec">🧠 Diseño IA · {iaResult.n} cámaras</h3>
              <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{iaResult.resumen}</div>
              {iaResult.equipos?.length > 0 && <div style={{ marginTop: 8 }}>{iaResult.equipos.map((e, i) => <div className="bom-row" key={i}><span>{e.descripcion}</span><b>×{e.cantidad}</b></div>)}</div>}
              <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setIaResult(null)}>OK</button>
            </div>
          )}

          {camSel && <CamProps cam={camSel} cat={catById(camSel.catId)} onUpd={updCam} onDel={delSel} />}
          {devSelObj && <div className="props"><h3 className="sec">{devById(devSelObj.devId)?.icono} {devById(devSelObj.devId)?.modelo}</h3><button className="btn danger" onClick={delSel}>🗑️ Eliminar</button></div>}

          <BOMPanel proj={proj} cableM={cableM} onPrecio={(k, v) => set({ precios: { ...proj.precios, [k]: v } })} onCable={(v) => set({ precioCableM: v })} />
        </aside>

        <main className="canvas">
          <svg ref={svgRef} className="svg" onPointerDown={onPointerDown}>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.zoom})`}>
              {proj.bg && <image href={proj.bg.url} x={0} y={0} width={proj.bg.w} height={proj.bg.h} />}
              {!proj.bg && <text x={20} y={40} fill="#5b6b86" fontSize={18}>Sube un plano para empezar →</text>}

              {proj.cameras.map((cam, i) => (
                <CamView key={cam.id} cam={cam} idx={i + 1} cat={catById(cam.catId)} ppm={ppm} walls={proj.walls} sel={sel?.kind === 'cam' && sel.id === cam.id} onDown={(e) => startDrag(e, 'cam', cam)} />
              ))}

              {proj.cables.map((c, i) => <line key={'k' + i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#22d3ee" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
              {proj.walls.map((w, i) => <line key={'w' + i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#e2e8f0" strokeWidth={3} vectorEffect="non-scaling-stroke" />)}

              {proj.devices.map((d, i) => {
                const dd = devById(d.devId)
                return (
                  <g key={d.id} onPointerDown={(e) => startDrag(e, 'dev', d)} style={{ cursor: 'move' }}>
                    <rect x={d.x - 12} y={d.y - 12} width={24} height={24} rx={5} fill={sel?.kind === 'dev' && sel.id === d.id ? '#0ea5e9' : '#1f2937'} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <text x={d.x} y={d.y + 5} fontSize={13} textAnchor="middle" style={{ pointerEvents: 'none' }}>{dd?.icono || '⬛'}</text>
                  </g>
                )
              })}

              {autoPts.length > 0 && <polyline points={autoPts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
              {autoPts.map((p, i) => <circle key={'a' + i} cx={p.x} cy={p.y} r={3} fill="#a855f7" vectorEffect="non-scaling-stroke" />)}
              {lineStart && <circle cx={lineStart.x} cy={lineStart.y} r={4} fill={mode === 'cable' ? '#22d3ee' : '#0ea5e9'} vectorEffect="non-scaling-stroke" />}
              {scalePts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="#22c55e" vectorEffect="non-scaling-stroke" />)}
            </g>
          </svg>
          <div className="legend">{BANDAS.slice().reverse().map((b) => (<span key={b.key}><i style={{ background: b.fill }} />{b.label}</span>))}</div>
        </main>
      </div>
    </div>
  )
}

// ─── BOM (cálculo) ───────────────────────────────────────────────────────────
export function buildBom(proj) {
  const grupos = {}
  for (const c of proj.cameras) {
    const cat = catById(c.catId); if (!cat) continue
    grupos[c.catId] = grupos[c.catId] || { key: c.catId, label: cat.marca + ' ' + cat.modelo, tipo: 'Cámara', qty: 0 }
    grupos[c.catId].qty++
  }
  for (const d of proj.devices) {
    const dd = devById(d.devId); if (!dd) continue
    grupos[d.devId] = grupos[d.devId] || { key: d.devId, label: dd.modelo, tipo: 'Equipo', qty: 0 }
    grupos[d.devId].qty++
  }
  const cableM = proj.pxPerMeter ? proj.cables.reduce((s, c) => s + Math.hypot(c.x2 - c.x1, c.y2 - c.y1), 0) / proj.pxPerMeter : 0
  const rows = Object.values(grupos).map((g) => {
    const unit = Number(proj.precios?.[g.key]) || 0
    return { ...g, unit, subtotal: unit * g.qty }
  })
  const cableUnit = Number(proj.precioCableM) || 0
  const cableRow = { key: '_cable', label: 'Cable UTP', tipo: 'Cable', qty: +cableM.toFixed(1), unit: cableUnit, subtotal: cableUnit * cableM, esMetros: true }
  const neto = rows.reduce((s, r) => s + r.subtotal, 0) + cableRow.subtotal
  const iva = Math.round(neto * 0.19)
  return { nombre: proj.nombre, rows, cableRow, neto, iva, total: neto + iva }
}

// ─── Vista de cámara con oclusión ───────────────────────────────────────────
function CamView({ cam, idx, cat, ppm, walls, sel, onDown }) {
  if (!cat) return null
  const cov = coberturaCamara(cat, cam.lenteIdx)
  const a1 = cam.rot - cov.hfov / 2, a2 = cam.rot + cov.hfov / 2
  const maxR = cov.dori.detectar * ppm
  const vis = visibilityPolygon(cam.x, cam.y, a1, a2, maxR, walls)
  const clipId = 'clip-' + cam.id
  const pts = vis.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <g onPointerDown={onDown} style={{ cursor: 'move' }}>
      <clipPath id={clipId}><polygon points={pts} /></clipPath>
      <g clipPath={`url(#${clipId})`}>
        {BANDAS.map((b) => <path key={b.key} d={sectorPath(cam.x, cam.y, cov.dori[b.key] * ppm, a1, a2)} fill={b.fill} stroke="none" />)}
      </g>
      <circle cx={cam.x} cy={cam.y} r={7} fill={sel ? '#0ea5e9' : '#111827'} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <text x={cam.x + 10} y={cam.y - 8} fill="#e6edf7" fontSize={13} stroke="#0b1220" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: 'none' }}>C{idx}</text>
    </g>
  )
}

function CamProps({ cam, cat, onUpd, onDel }) {
  if (!cat) return null
  const cov = coberturaCamara(cat, cam.lenteIdx)
  return (
    <div className="props">
      <h3 className="sec">{cat.marca} {cat.modelo}</h3>
      <div className="muted">{cat.mp ? cat.mp + 'MP' : ''} · {cat.tipo}</div>
      <label className="lbl">Lente / focal</label>
      <select className="in" value={cam.lenteIdx} onChange={(e) => onUpd(cam.id, { lenteIdx: +e.target.value })}>
        {(cat.lentes || []).map((l, i) => (<option key={i} value={i}>{l.focal_mm}mm {l.hfov_publicado_deg ? `(${l.hfov_publicado_deg}°)` : '(est.)'}</option>))}
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
      <button className="btn danger" onClick={() => onDel()}>🗑️ Eliminar cámara</button>
    </div>
  )
}

function BOMPanel({ proj, cableM, onPrecio, onCable }) {
  const bom = buildBom(proj)
  if (bom.rows.length === 0 && cableM === 0) return null
  return (
    <div className="props">
      <h3 className="sec">📋 Materiales y precios</h3>
      {bom.rows.map((r) => (
        <div className="bom-edit" key={r.key}>
          <div className="bom-l"><b>{r.label}</b><span>×{r.qty}</span></div>
          <input className="precio" type="number" placeholder="precio unit" value={proj.precios?.[r.key] || ''} onChange={(e) => onPrecio(r.key, +e.target.value)} />
        </div>
      ))}
      <div className="bom-edit">
        <div className="bom-l"><b>Cable UTP</b><span>{cableM.toFixed(1)} m</span></div>
        <input className="precio" type="number" placeholder="$/m" value={proj.precioCableM || ''} onChange={(e) => onCable(+e.target.value)} />
      </div>
      <div className="tot">
        <div className="t-row"><span>Neto</span><b>{clp(bom.neto)}</b></div>
        <div className="t-row"><span>IVA 19%</span><b>{clp(bom.iva)}</b></div>
        <div className="t-row tot-f"><span>Total</span><b>{clp(bom.total)}</b></div>
      </div>
    </div>
  )
}
