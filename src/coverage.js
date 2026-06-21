'use strict';
// Motor de cobertura CCTV — calcula FOV, PPM y distancias DORI (norma EN 62676-4)
// a partir de los specs físicos de la cámara. 100% propio, sin datos de terceros.
//
// Fuente de verdad del FOV: el datasheet del fabricante (hfovDeg). Si no se tiene,
// se estima desde sensor + focal con la fórmula de lente delgada (aproximada).

// Ancho horizontal del sensor (mm) por formato óptico estándar.
const SENSOR_ANCHO_MM = {
  '1/4': 3.6, '1/3.6': 4.0, '1/3.2': 4.54, '1/3': 4.8, '1/2.9': 4.96,
  '1/2.8': 5.12, '1/2.7': 5.37, '1/2.5': 5.76, '1/2.3': 6.17, '1/2': 6.4,
  '1/1.8': 7.18, '1/1.7': 7.6, '1/1.2': 10.67, '1': 12.8,
};

const grados = (rad) => (rad * 180) / Math.PI;
const radianes = (deg) => (deg * Math.PI) / 180;

function anchoSensor(formato, fallbackMm) {
  if (typeof formato === 'number') return formato;
  const key = String(formato || '').replace(/["”\s]/g, '').trim();
  return SENSOR_ANCHO_MM[key] || fallbackMm || 5.12; // 1/2.8" por defecto
}

// Ángulo horizontal de visión (grados) estimado desde sensor y focal.
function hfovDesdeLente(sensorAnchoMm, focalMm) {
  return grados(2 * Math.atan(sensorAnchoMm / (2 * focalMm)));
}

// Ancho cubierto (m) a una distancia d (m), dado el FOV horizontal.
function anchoCobertura(hfovDeg, d) {
  return 2 * d * Math.tan(radianes(hfovDeg) / 2);
}

// Píxeles por metro a distancia d.
function ppm(resolucionW, hfovDeg, d) {
  return resolucionW / anchoCobertura(hfovDeg, d);
}

// Umbrales DORI (EN 62676-4), en px/m.
const DORI = { detectar: 25, observar: 62, reconocer: 125, identificar: 250 };

// Distancia máxima (m) a la que se alcanza cada nivel DORI.
function distanciasDORI(resolucionW, hfovDeg) {
  const t = Math.tan(radianes(hfovDeg) / 2);
  const dist = (umbral) => resolucionW / (2 * umbral * t);
  return {
    detectar: +dist(DORI.detectar).toFixed(1),
    observar: +dist(DORI.observar).toFixed(1),
    reconocer: +dist(DORI.reconocer).toFixed(1),
    identificar: +dist(DORI.identificar).toFixed(1),
  };
}

// Cobertura completa de una cámara con una focal/lente dada.
// Acepta hfovDeg (datasheet, preferido) o lo estima desde sensor+focal.
function cobertura({ resolucionW, hfovDeg, sensorFormato, sensorAnchoMm, focalMm }) {
  let h = hfovDeg;
  let estimado = false;
  if (!h) {
    const sw = anchoSensor(sensorFormato, sensorAnchoMm);
    h = hfovDesdeLente(sw, focalMm);
    estimado = true;
  }
  return {
    hfov: +h.toFixed(1),
    hfovEstimado: estimado,
    dori: distanciasDORI(resolucionW, h),
  };
}

module.exports = {
  SENSOR_ANCHO_MM, anchoSensor, hfovDesdeLente,
  anchoCobertura, ppm, DORI, distanciasDORI, cobertura,
};
