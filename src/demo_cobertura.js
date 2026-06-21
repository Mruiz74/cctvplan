'use strict';
// Demo: calcula la cobertura DORI real de varias cámaras del catálogo.
const C = require('./coverage.js');
const db = require('../data/camaras.seed.json');

const ids = ['hik-ds2cd2046g2i', 'dah-ipchfw5842eze', 'axis-m2035le', 'han-xnoa9084r'];
for (const id of ids) {
  const cam = db.camaras.find((c) => c.id === id);
  console.log('\n' + cam.marca + ' ' + cam.modelo + '  (' + cam.mp + 'MP, ' + cam.resolucion_w + 'px)');
  for (const l of cam.lentes) {
    if (l.hfov_publicado_deg == null) continue;
    const cov = C.cobertura({ resolucionW: cam.resolucion_w, hfovDeg: l.hfov_publicado_deg });
    const d = cov.dori;
    console.log('  ' + l.focal_mm + 'mm (' + cov.hfov + '°)  ->  Identificar ' + d.identificar + 'm | Reconocer ' + d.reconocer + 'm | Observar ' + d.observar + 'm | Detectar ' + d.detectar + 'm');
  }
}
