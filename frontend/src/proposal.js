const clp = (n) => '$' + (Math.round(Number(n) || 0)).toLocaleString('es-CL')

// Abre una ventana con la propuesta lista para imprimir / guardar como PDF.
export function abrirPropuesta(bom) {
  const fecha = new Date().toLocaleDateString('es-CL')
  const filas = [...bom.rows.map((r) => ({ ...r })), bom.cableRow]
    .filter((r) => r.qty > 0)
    .map((r) => `<tr>
        <td>${r.label}</td><td>${r.tipo}</td>
        <td class="r">${r.esMetros ? r.qty + ' m' : r.qty}</td>
        <td class="r">${clp(r.unit)}</td>
        <td class="r">${clp(r.subtotal)}</td>
      </tr>`).join('')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Propuesta — ${bom.nombre}</title>
  <style>
    *{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
    body{margin:0;padding:40px;color:#0b1220}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0ea5e9;padding-bottom:16px}
    .brand{font-size:22px;font-weight:800}
    .brand small{display:block;font-weight:500;color:#64748b;font-size:12px;letter-spacing:2px}
    h1{font-size:18px;margin:24px 0 4px}
    .meta{color:#64748b;font-size:13px;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:13px}
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
      <div class="brand">🎥 CCTVPLAN<small>PROPUESTA DE PROYECTO CCTV</small></div>
      <div style="text-align:right;color:#64748b;font-size:13px">${fecha}</div>
    </div>
    <h1>${bom.nombre}</h1>
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
    <div class="foot">Generado con CCTVPLAN · Cobertura calculada según norma EN 62676-4 (zonas DORI). Valores referenciales.</div>
    <button class="noprint" onclick="window.print()" style="margin-top:24px;padding:10px 18px;border:none;border-radius:8px;background:#0ea5e9;color:#fff;font-weight:700;cursor:pointer">🖨️ Imprimir / Guardar PDF</button>
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Permite las ventanas emergentes para ver la propuesta.'); return }
  w.document.write(html)
  w.document.close()
}
