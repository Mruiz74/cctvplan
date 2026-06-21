import { useEffect, useRef, useState } from 'react'
import catalogo from './data/camaras.json'
import dispositivos from './data/dispositivos.json'
import { coberturaCamara } from './lib/coverage'
import { sectorPath, dist, clamp, visibilityPolygon } from './geom'
import { abrirPropuesta } from './proposal'

const CAMS = catalogo.camaras
const DEVS = dispositivos.dispositivos
// Cámaras del usuario (importadas de datasheets), persistidas en localStorage.
let CUSTOM = (() => { try { return JSON.parse(localStorage.getItem('cctvplan_cams') || '[]') } catch { return [] } })()
const catById = (id) => CAMS.find((c) => c.id === id) || CUSTOM.find((c) => c.id === id)
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
  const [dxf, setDxf] = useState(null) // { data, sel:Set } — selector de capas DXF
  const [sat, setSat] = useState(null) // { dir, metros, loading, err } — modal satélite
  const [customCams, setCustomCams] = useState(CUSTOM)
  const [dsLoading, setDsLoading] = useState(false)
  const [dsResult, setDsResult] = useState(null) // cámara leída del datasheet, pendiente de confirmar
  const [auth, setAuth] = useState(() => { try { return JSON.parse(localStorage.getItem('cctvplan_auth') || 'null') } catch { return null } })
  const [cloud, setCloud] = useState(null) // modal proyectos en la nube
  const [cloudId, setCloudId] = useState(null) // id del proyecto abierto en la nube
  const svgRef = useRef(null)
  const drag = useRef(null)
  const projRef = useRef(proj)
  const hist = useRef({ past: [], future: [] })

  useEffect(() => {
    projRef.current = proj
    try { localStorage.setItem(STORE, JSON.stringify(proj)) }
    catch { /* plano muy grande para guardar local: el proyecto sigue en memoria */ }
  }, [proj])

  useEffect(() => {
    CUSTOM = customCams // para que catById (módulo) encuentre las del usuario
    try { localStorage.setItem('cctvplan_cams', JSON.stringify(customCams)) } catch { /* */ }
  }, [customCams])

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
    if (/\.dxf$/i.test(file.name)) {
      try {
        const txt = await file.text()
        const { parseDXF } = await import('./lib/dxf') // se carga solo al usar DXF
        const res = parseDXF(txt)
        const pre = res.layers.filter((l) => /muro|wall|constru|cierro|tabique|perimetr|edific/i.test(l.name)).map((l) => l.name)
        setProj((p) => ({ ...p, bg: { url: '', w: res.w, h: res.h }, pxPerMeter: res.pxPerMeter || p.pxPerMeter }))
        fitView({ w: res.w, h: res.h })
        setDxf({ data: res, sel: new Set(pre) })
      } catch (e) { console.error(e); alert(e.message || 'No se pudo leer el DXF') }
      return
    }
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
    if (mode === 'camera' || mode === 'device' || mode === 'wall' || mode === 'cable' || (mode === 'rect' && lineStart) || (mode === 'scale' && scalePts.length === 1)) snapshot()
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
    if (mode === 'rect') {
      if (!lineStart) setLineStart(w)
      else {
        const ax = Math.min(lineStart.x, w.x), ay = Math.min(lineStart.y, w.y), bx = Math.max(lineStart.x, w.x), by = Math.max(lineStart.y, w.y)
        set({ walls: [...proj.walls,
          { x1: ax, y1: ay, x2: bx, y2: ay },
          { x1: bx, y1: ay, x2: bx, y2: by },
          { x1: bx, y1: by, x2: ax, y2: by },
          { x1: ax, y1: by, x2: ax, y2: ay },
        ] })
        setLineStart(null)
      }
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

  const toggleCapa = (name) => setDxf((d) => { const s = new Set(d.sel); s.has(name) ? s.delete(name) : s.add(name); return { ...d, sel: s } })
  const importarCapas = () => {
    if (!dxf) return
    const muros = dxf.data.segs.filter((s) => dxf.sel.has(s.layer)).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }))
    snapshot(); setProj((p) => ({ ...p, walls: muros })); setDxf(null)
  }

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

  // Trae una imagen satelital del sitio por dirección, ya calibrada a escala real.
  const buscarSatelite = async () => {
    const dir = (sat.dir || '').trim()
    if (!dir) { setSat((s) => ({ ...s, err: 'Escribe una dirección.' })); return }
    setSat((s) => ({ ...s, loading: true, err: '' }))
    try {
      const r = await fetch(API_IA + '/api/satelite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direccion: dir, metros: sat.metros }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'No se pudo obtener la imagen')
      snapshot()
      setProj((p) => ({ ...p, bg: { url: data.imagen, w: data.w, h: data.h }, pxPerMeter: data.pxPerMeter }))
      fitView({ w: data.w, h: data.h })
      setSat(null)
    } catch (e) { setSat((s) => ({ ...s, loading: false, err: e.message || 'Error al traer la imagen' })) }
  }

  // ---------- Proyectos en la nube (login propio + Neon) ----------
  const guardarAuth = (a) => { setAuth(a); try { localStorage.setItem('cctvplan_auth', JSON.stringify(a)) } catch { /* */ } }
  const logout = () => { setAuth(null); setCloudId(null); localStorage.removeItem('cctvplan_auth'); setCloud((c) => ({ ...(c || {}), tab: 'login', list: [], err: '' })) }
  const apiAuth = (path, opts = {}) => fetch(API_IA + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth.token } : {}), ...(opts.headers || {}) } })

  const cargarLista = async () => {
    if (!auth) return
    try {
      const r = await apiAuth('/api/proyectos')
      if (r.status === 401) { logout(); return }
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      setCloud((c) => ({ ...(c || {}), list: data.proyectos || [], err: '' }))
    } catch (e) { setCloud((c) => ({ ...(c || {}), err: e.message || 'No se pudo cargar la lista' })) }
  }

  const doAuth = async () => {
    const reg = cloud.tab === 'register'
    setCloud((s) => ({ ...s, loading: true, err: '' }))
    try {
      const r = await fetch(API_IA + (reg ? '/api/register' : '/api/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: cloud.nombre, email: cloud.email, password: cloud.password }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      guardarAuth({ token: data.token, user: data.user })
      setCloud((s) => ({ ...s, loading: false, err: '', password: '', tab: 'list' }))
      cargarLista()
    } catch (e) { setCloud((s) => ({ ...s, loading: false, err: e.message || 'Error' })) }
  }

  const guardarNube = async (forceNew) => {
    if (!auth) { setCloud({ tab: 'login', email: '', password: '', nombre: '', err: '', list: [] }); return }
    setCloud((c) => ({ ...(c || {}), saving: true, err: '', msg: '' }))
    try {
      const body = JSON.stringify({ nombre: proj.nombre, data: proj })
      const useId = !forceNew && cloudId
      const r = useId ? await apiAuth('/api/proyectos/' + useId, { method: 'PUT', body }) : await apiAuth('/api/proyectos', { method: 'POST', body })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      setCloudId(data.proyecto.id)
      setCloud((c) => ({ ...(c || {}), saving: false, msg: 'Guardado en la nube ✓' }))
      cargarLista()
    } catch (e) { setCloud((c) => ({ ...(c || {}), saving: false, err: e.message || 'No se pudo guardar' })) }
  }

  const abrirNube = async (id) => {
    try {
      const r = await apiAuth('/api/proyectos/' + id)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error')
      hist.current = { past: [], future: [] }
      const d = data.proyecto.data || {}
      setProj({ ...nuevoProyecto(), ...d, nombre: data.proyecto.nombre })
      setCloudId(id); setSel(null); setCloud(null)
      fitView(d.bg)
    } catch (e) { setCloud((c) => ({ ...(c || {}), err: e.message || 'No se pudo abrir' })) }
  }

  const borrarNube = async (id) => {
    if (!confirm('¿Borrar este proyecto de la nube? No se puede deshacer.')) return
    try {
      const r = await apiAuth('/api/proyectos/' + id, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Error') }
      if (id === cloudId) setCloudId(null)
      cargarLista()
    } catch (e) { setCloud((c) => ({ ...(c || {}), err: e.message || 'No se pudo borrar' })) }
  }

  const abrirModalNube = () => {
    setCloud({ tab: auth ? 'list' : 'login', email: auth?.user?.email || '', password: '', nombre: '', err: '', msg: '', list: [] })
    if (auth) cargarLista()
  }

  // ---------- Importar cámara desde datasheet (Claude visión) ----------
  const importarDatasheet = async (file) => {
    if (!file) return
    setDsLoading(true)
    try {
      let dataUrl
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const buf = await file.arrayBuffer()
        const { pdfABackground } = await import('./lib/pdf')
        const bg = await pdfABackground(buf)
        dataUrl = bg.url
      } else {
        dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
      }
      const r = await fetch(API_IA + '/api/datasheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagenDataUrl: dataUrl }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error del servidor')
      setDsResult(data.camara)
    } catch (e) { alert(e.message || 'No se pudo leer el datasheet') } finally { setDsLoading(false) }
  }

  const confirmarDatasheet = () => {
    const c = dsResult
    const slug = ((c.marca || '') + (c.modelo || '')).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 28)
    const cam = { ...c, id: 'user-' + slug + '-' + Date.now().toString(36), _user: true }
    if (!cam.resolucion_w && cam.mp) { cam.resolucion_w = Math.round(Math.sqrt((cam.mp * 1e6 * 16) / 9)); cam.resolucion_h = Math.round((cam.resolucion_w * 9) / 16) }
    if (!Array.isArray(cam.lentes) || !cam.lentes.length) cam.lentes = [{ focal_mm: 4, hfov_publicado_deg: null }]
    setCustomCams((a) => [...a, cam])
    setMarca(cam.marca); setCatSel(cam.id); setCatTab('camaras')
    setDsResult(null)
  }

  const borrarCamUser = (id) => { setCustomCams((a) => a.filter((c) => c.id !== id)); if (catSel === id) setCatSel(null) }

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
          catalogo: cams.filter((c) => !c._es_serie),
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
  const cams = customCams.length ? [...CAMS, ...customCams] : CAMS
  const marcas = customCams.length ? [...new Set(cams.map((c) => c.marca))] : MARCAS

  const cableM = proj.pxPerMeter ? proj.cables.reduce((s, c) => s + dist(c.x1, c.y1, c.x2, c.y2), 0) / proj.pxPerMeter : 0

  return (
    <div className="app">
      <header className="bar">
        <span className="logo">🎥 CCTVPLAN</span>
        <input className="proj-name" value={proj.nombre} onChange={(e) => set({ nombre: e.target.value })} />
        <button className={'btn ' + (auth ? 'on' : '')} onClick={abrirModalNube} title="Guardar / abrir proyectos en la nube">☁️ {cloudId ? 'Guardado' : 'Proyectos'}</button>
        <label className="btn"><input type="file" accept="image/*,application/pdf,.dxf" style={{ display: 'none' }} onChange={(e) => subirPlano(e.target.files[0])} />📐 Plano</label>
        <button className="btn" onClick={() => setSat({ dir: '', metros: 120, loading: false, err: '' })} title="Traer imagen satelital por dirección (exteriores)">🛰️ Satélite</button>
        <button className={'btn ' + (mode === 'scale' ? 'on' : '')} onClick={() => { setMode('scale'); setScalePts([]) }}>📏 Escala</button>
        <button className={'btn ' + (mode === 'wall' ? 'on' : '')} onClick={() => { setMode(mode === 'wall' ? 'select' : 'wall'); setLineStart(null) }}>🧱 Muro</button>
        <button className={'btn ' + (mode === 'rect' ? 'on' : '')} onClick={() => { setMode(mode === 'rect' ? 'select' : 'rect'); setLineStart(null) }} title="Dibujar una sala (rectángulo) en 2 clics">▭ Sala</button>
        <button className="btn" disabled={murosLoading} onClick={detectarMurosIA} title="Detectar recintos con IA (aproximado)">{murosLoading ? '🪄…' : '🪄 Muros IA'}</button>
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
            <label className="btn" style={{ width: '100%', marginBottom: 8, textAlign: 'center' }}>
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={dsLoading} onChange={(e) => { importarDatasheet(e.target.files[0]); e.target.value = '' }} />
              {dsLoading ? '📄 Leyendo datasheet…' : '📄 Importar desde datasheet'}
            </label>
            <select className="in" value={marca} onChange={(e) => setMarca(e.target.value)}>{marcas.map((m) => <option key={m}>{m}</option>)}</select>
            <div className="cat">
              {cams.filter((c) => c.marca === marca).map((c) => (
                <button key={c.id} className={'cat-item ' + (catSel === c.id && (mode === 'camera' || mode === 'auto') ? 'on' : '')} onClick={() => { setCatSel(c.id); if (mode !== 'auto') setMode('camera') }}>
                  <b>{c.modelo} {c._user ? '👤' : ''}</b><span>{c.mp ? c.mp + 'MP · ' : ''}{c.tipo}{c._user ? ' · tuya' : ''}</span>
                  {c._user && <span className="del-cam" onClick={(ev) => { ev.stopPropagation(); borrarCamUser(c.id) }} title="Quitar del catálogo">🗑</span>}
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
                  {marcas.map((m) => <option key={m} value={m}>Solo {m}</option>)}
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
              {proj.bg?.url && <image href={proj.bg.url} x={0} y={0} width={proj.bg.w} height={proj.bg.h} />}
              {!proj.bg && <text x={20} y={40} fill="#5b6b86" fontSize={18}>Sube un plano para empezar →</text>}

              {proj.cameras.map((cam, i) => (
                <CamView key={cam.id} cam={cam} idx={i + 1} cat={catById(cam.catId)} ppm={ppm} walls={proj.walls} sel={sel?.kind === 'cam' && sel.id === cam.id} onDown={(e) => startDrag(e, 'cam', cam)} />
              ))}

              {proj.cables.map((c, i) => <line key={'k' + i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#22d3ee" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
              {proj.walls.map((w, i) => <line key={'w' + i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#2563eb" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}

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

      {dxf && (
        <div className="modal-bg" onClick={() => setDxf(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="sec">Importar capas del DXF como muros</h3>
            <div className="muted">Marca las capas que son murallas / construcción / cierre perimetral. {dxf.data.pxPerMeter ? '✓ Escala detectada del DXF.' : 'Sin unidades: calibra con 📏 luego.'}</div>
            <div className="layer-list">
              {dxf.data.layers.map((l) => (
                <label className="layer-row" key={l.name}>
                  <input type="checkbox" checked={dxf.sel.has(l.name)} onChange={() => toggleCapa(l.name)} />
                  <span className="ln">{l.name}</span><span className="lc">{l.count}</span>
                </label>
              ))}
            </div>
            <button className="btn on" style={{ width: '100%' }} onClick={importarCapas}>Importar {dxf.sel.size} capa(s)</button>
            <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setDxf(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {sat && (
        <div className="modal-bg" onClick={() => !sat.loading && setSat(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="sec">🛰️ Imagen satelital por dirección</h3>
            <div className="muted">Escribe la dirección del sitio. Traigo la foto aérea <b>ya a escala real</b> — lista para diseñar exteriores.</div>
            <input className="in" placeholder="Ej: Av. Apoquindo 6410, Las Condes, Chile" value={sat.dir}
              onChange={(e) => setSat((s) => ({ ...s, dir: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') buscarSatelite() }} autoFocus />
            <label className="lbl">Área a cubrir: {sat.metros} m de lado</label>
            <input className="range" type="range" min={40} max={400} step={10} value={sat.metros}
              onChange={(e) => setSat((s) => ({ ...s, metros: +e.target.value }))} />
            {sat.err && <div className="err">{sat.err}</div>}
            <button className="btn on" style={{ width: '100%', marginTop: 10 }} disabled={sat.loading} onClick={buscarSatelite}>{sat.loading ? 'Buscando…' : 'Traer imagen'}</button>
            <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={sat.loading} onClick={() => setSat(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {cloud && (
        <div className="modal-bg" onClick={() => setCloud(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!auth ? (
              <>
                <h3 className="sec">☁️ Proyectos en la nube</h3>
                <div className="tabs">
                  <button className={cloud.tab === 'login' ? 'tab on' : 'tab'} onClick={() => setCloud((c) => ({ ...c, tab: 'login', err: '' }))}>Entrar</button>
                  <button className={cloud.tab === 'register' ? 'tab on' : 'tab'} onClick={() => setCloud((c) => ({ ...c, tab: 'register', err: '' }))}>Crear cuenta</button>
                </div>
                {cloud.tab === 'register' && <input className="in" placeholder="Tu nombre" value={cloud.nombre} onChange={(e) => setCloud((c) => ({ ...c, nombre: e.target.value }))} />}
                <input className="in" placeholder="Email" type="email" value={cloud.email} onChange={(e) => setCloud((c) => ({ ...c, email: e.target.value }))} />
                <input className="in" placeholder="Contraseña (mín. 6)" type="password" value={cloud.password} onChange={(e) => setCloud((c) => ({ ...c, password: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') doAuth() }} />
                {cloud.err && <div className="err">{cloud.err}</div>}
                <button className="btn on" style={{ width: '100%', marginTop: 6 }} disabled={cloud.loading} onClick={doAuth}>{cloud.loading ? '…' : (cloud.tab === 'register' ? 'Crear cuenta' : 'Entrar')}</button>
                <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setCloud(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <h3 className="sec">☁️ Mis proyectos</h3>
                <div className="muted">{auth.user?.email} · <span style={{ color: '#7dd3fc', cursor: 'pointer' }} onClick={logout}>Cerrar sesión</span></div>
                <button className="btn on" style={{ width: '100%', marginTop: 8 }} disabled={cloud.saving} onClick={() => guardarNube(false)}>{cloud.saving ? 'Guardando…' : (cloudId ? '💾 Guardar cambios' : '💾 Guardar este proyecto')}</button>
                {cloudId && <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={cloud.saving} onClick={() => guardarNube(true)}>📑 Guardar como copia nueva</button>}
                {cloud.msg && <div className="hint" style={{ marginTop: 8 }}>{cloud.msg}</div>}
                {cloud.err && <div className="err">{cloud.err}</div>}
                <div className="layer-list" style={{ marginTop: 10 }}>
                  {(cloud.list || []).length === 0 && <div className="muted" style={{ padding: 12 }}>Aún no tienes proyectos guardados. Diseña y pulsa "Guardar".</div>}
                  {(cloud.list || []).map((p) => (
                    <div className="layer-row" key={p.id}>
                      <span className="ln" style={{ cursor: 'pointer' }} onClick={() => abrirNube(p.id)}>{p.id === cloudId ? '● ' : ''}{p.nombre}</span>
                      <button className="btn" style={{ padding: '3px 8px' }} onClick={() => abrirNube(p.id)}>Abrir</button>
                      <button className="btn" style={{ padding: '3px 8px' }} onClick={() => borrarNube(p.id)} title="Borrar">🗑</button>
                    </div>
                  ))}
                </div>
                <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setCloud(null)}>Cerrar</button>
              </>
            )}
          </div>
        </div>
      )}

      {dsResult && (
        <div className="modal-bg" onClick={() => setDsResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="sec">📄 Cámara leída del datasheet</h3>
            <div className="muted">Revisa los datos y confírmalos. Confianza de lectura: <b>{dsResult.confianza || '—'}</b></div>
            <div className="dsbox">
              <div className="ds-tit">{dsResult.marca} {dsResult.modelo}</div>
              <div className="muted">{dsResult.tipo} · {dsResult.mp}MP · sensor {dsResult.sensor_formato}"{dsResult.resolucion_w ? ` · ${dsResult.resolucion_w}×${dsResult.resolucion_h}` : ''}</div>
              <div className="muted">Lentes: {(dsResult.lentes || []).map((l) => l.focal_mm + 'mm' + (l.hfov_publicado_deg ? ` (${l.hfov_publicado_deg}°)` : '')).join(', ') || '—'}</div>
              <div className="muted">{[dsResult.ir_alcance_m ? 'IR ' + dsResult.ir_alcance_m + 'm' : '', dsResult.ip_rating, dsResult.ik_rating, dsResult.poe ? 'PoE' : ''].filter(Boolean).join(' · ')}</div>
              {!!(dsResult.caracteristicas || []).length && <div className="muted">{dsResult.caracteristicas.join(' · ')}</div>}
            </div>
            {dsResult.confianza === 'baja' && <div className="err">Lectura de baja confianza — verifica los datos contra el datasheet antes de usar.</div>}
            <button className="btn on" style={{ width: '100%', marginTop: 8 }} onClick={confirmarDatasheet}>Agregar al catálogo</button>
            <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setDsResult(null)}>Descartar</button>
          </div>
        </div>
      )}
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
