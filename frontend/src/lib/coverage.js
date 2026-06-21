// Motor de cobertura CCTV (FOV/DORI/PPM, EN 62676-4). 100% propio. Versión ESM.

export const SENSOR_ANCHO_MM = {
  '1/4': 3.6, '1/3.6': 4.0, '1/3.2': 4.54, '1/3': 4.8, '1/2.9': 4.96,
  '1/2.8': 5.12, '1/2.7': 5.37, '1/2.5': 5.76, '1/2.3': 6.17, '1/2': 6.4,
  '1/1.8': 7.18, '1/1.7': 7.6, '1/1.2': 10.67, '1': 12.8,
}

const gr = (rad) => (rad * 180) / Math.PI
const rad = (deg) => (deg * Math.PI) / 180

export function anchoSensor(formato, fallbackMm) {
  if (typeof formato === 'number') return formato
  const key = String(formato || '').replace(/["”\s]/g, '').trim()
  return SENSOR_ANCHO_MM[key] || fallbackMm || 5.12
}

export function hfovDesdeLente(sensorAnchoMm, focalMm) {
  return gr(2 * Math.atan(sensorAnchoMm / (2 * focalMm)))
}

export const DORI = { detectar: 25, observar: 62, reconocer: 125, identificar: 250 }

export function distanciasDORI(resolucionW, hfovDeg) {
  const t = Math.tan(rad(hfovDeg) / 2)
  const d = (u) => resolucionW / (2 * u * t)
  return {
    detectar: +d(DORI.detectar).toFixed(1),
    observar: +d(DORI.observar).toFixed(1),
    reconocer: +d(DORI.reconocer).toFixed(1),
    identificar: +d(DORI.identificar).toFixed(1),
  }
}

// Cobertura para una cámara del catálogo con un índice de lente.
export function coberturaCamara(cam, lenteIdx = 0) {
  const lente = (cam.lentes && cam.lentes[lenteIdx]) || (cam.lentes && cam.lentes[0]) || {}
  const resW = cam.resolucion_w || cam.resolucion_w_por_sensor || 1920
  let hfov = lente.hfov_publicado_deg
  let estimado = false
  if (hfov == null) {
    const sw = anchoSensor(cam.sensor_formato)
    hfov = lente.focal_mm ? hfovDesdeLente(sw, lente.focal_mm) : 90
    estimado = true
  }
  return { hfov: +Number(hfov).toFixed(1), estimado, focal_mm: lente.focal_mm, dori: distanciasDORI(resW, hfov) }
}
