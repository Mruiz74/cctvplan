const clp = (n) => '$' + (Math.round(Number(n) || 0)).toLocaleString('es-CL')
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Diagrama unifilar simple: Cámaras → Switch PoE → NVR → UPS.
function diagramaRed(s) {
  if (!s || !s.nCam) return ''
  const box = (x, title, sub, color) => `
    <g transform="translate(${x},20)">
      <rect width="140" height="64" rx="10" fill="${color}"/>
      <text x="70" y="29" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${esc(title)}</text>
      <text x="70" y="47" text-anchor="middle" fill="#eef2ff" font-size="11">${esc(sub)}</text>
    </g>`
  const arrow = (x) => `<line x1="${x}" y1="52" x2="${x + 30}" y2="52" stroke="#94a3b8" stroke-width="2" marker-end="url(#ar)"/>`
  return `<svg width="100%" viewBox="0 0 760 104" style="margin-top:10px">
    <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8"/></marker></defs>
    ${box(0, 'Cámaras', s.nCam + ' IP / PoE', '#0ea5e9')}${arrow(140)}
    ${box(170, 'Switch PoE', s.puertos + ' puertos', '#6366f1')}${arrow(310)}
    ${box(340, 'NVR / Grabador', s.canales + ' ch · ' + s.discoTB + ' TB', '#8b5cf6')}${arrow(480)}
    ${box(510, 'UPS', 'Respaldo de energía', '#22c55e')}
  </svg>`
}

// Abre una ventana con la propuesta lista para imprimir / guardar como PDF.
// opts: { empresa:{nombre,contacto,logo}, cliente, sistema }
export function abrirPropuesta(bom, opts = {}) {
  const fecha = new Date().toLocaleDateString('es-CL')
  const emp = opts.empresa || {}
  const s = opts.sistema
  const filas = [...bom.rows.map((r) => ({ ...r })), bom.cableRow]
    .filter((r) => r.qty > 0)
    .map((r) => `<tr>
        <td>${esc(r.label)}</td><td>${esc(r.tipo)}</td>
        <td class="r">${r.esMetros ? r.qty + ' m' : r.qty}</td>
        <td class="r">${clp(r.unit)}</td>
        <td class="r">${clp(r.subtotal)}</td>
      </tr>`).join('')

  const header = emp.logo
    ? `<img src="${emp.logo}" alt="logo" style="max-height:58px;max-width:200px;object-fit:contain"/>`
    : `<div class="brand">${esc(emp.nombre) || '🎥 CCTVPLAN'}<small>PROPUESTA DE PROYECTO CCTV</small></div>`

  const sis = s && s.nCam ? `
    <h1 style="margin-top:28px">Resumen técnico del sistema</h1>
    <div class="grid4">
      <div class="kpi"><span>Cámaras</span><b>${s.nCam}</b></div>
      <div class="kpi"><span>Ancho de banda</span><b>${s.mbps.toFixed(1)} Mbps</b></div>
      <div class="kpi"><span>Almacenamiento</span><b>${s.tb.toFixed(1)} TB</b></div>
      <div class="kpi"><span>Retención</span><b>${s.dias} días</b></div>
    </div>
    ${diagramaRed(s)}` : ''

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Propuesta — ${esc(bom.nombre)}</title>
  <style>
    *{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
    body{margin:0;padding:40px;color:#0b1220}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0ea5e9;padding-bottom:16px}
    .brand{font-size:22px;font-weight:800}
    .brand small{display:block;font-weight:500;color:#64748b;font-size:12px;letter-spacing:2px}
    h1{font-size:18px;margin:24px 0 4px}
    .meta{color:#64748b;font-size:13px;margin-bottom:18px}
    .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0}
    .kpi{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
    .kpi span{display:block;color:#64748b;font-size:11px}
    .kpi b{font-size:17px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
    th,td{padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:left}
    th{background:#0ea5e9;color:#fff;font-size:12px}
    td.r,th.r{text-align:right}
    .tot{margin-top:16px;margin-left:auto;width:280px}
    .tot div{display:flex;justify-content:space-between;padding:5px 0}
    .tot .f{border-top:2px solid #0b1220;font-weight:800;font-size:16px;padding-top:8px}
    .foot{margin-top:40px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}
    @media print{ body{padding:0} .noprint{display:none} }
  </style></head><body>
    <div class="top">
      ${header}
      <div style="text-align:right;color:#64748b;font-size:13px">
        ${emp.logo && emp.nombre ? `<div style="font-weight:700;color:#0b1220;font-size:15px">${esc(emp.nombre)}</div>` : ''}
        <div>${fecha}</div>
        ${opts.cliente ? `<div>Cliente: <b style="color:#0b1220">${esc(opts.cliente)}</b></div>` : ''}
      </div>
    </div>
    <h1>${esc(bom.nombre)}</h1>
    <div class="meta">Detalle de equipos y materiales</div>
    <table>
      <thead><tr><th>Ítem</th><th>Tipo</th><th class="r">Cant.</th><th class="r">Unitario</th><th class="r">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="tot">
      <div><span>Neto</span><b>${clp(bom.neto)}</b></div>
      <div><span>IVA 19%</span><b>${clp(bom.iva)}</b></div>
      <div class="f"><span>Total</span><b>${clp(bom.total)}</b></div>
    </div>
    ${sis}
    <div class="foot">${emp.contacto ? esc(emp.contacto) + ' · ' : ''}Generado con CCTVPLAN · Cobertura según norma EN 62676-4 (zonas DORI). Valores referenciales.</div>
    <button class="noprint" onclick="window.print()" style="margin-top:24px;padding:10px 18px;border:none;border-radius:8px;background:#0ea5e9;color:#fff;font-weight:700;cursor:pointer">🖨️ Imprimir / Guardar PDF</button>
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Permite las ventanas emergentes para ver la propuesta.'); return }
  w.document.write(html)
  w.document.close()
}
