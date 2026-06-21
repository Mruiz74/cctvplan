'use strict';
const sharp = require('sharp');
const { GOOGLE_MAPS_KEY } = require('./config');

// Imagen satelital por dirección, ya calibrada a escala real (px/m).
// Si hay GOOGLE_MAPS_KEY → Google Static Maps (mejor imagen, sobre todo en Chile).
// Si no → mosaico de tiles de Esri World Imagery (gratis, sin API key).

const D2R = Math.PI / 180;
const mppAt = (lat, z) => 156543.03392 * Math.cos(lat * D2R) / Math.pow(2, z); // metros por píxel
const lngToGlobalX = (lng, z) => ((lng + 180) / 360) * 256 * Math.pow(2, z);
const latToGlobalY = (lat, z) => {
  const s = Math.sin(lat * D2R);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
};

async function geocodeNominatim(direccion) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(direccion);
  const r = await fetch(url, { headers: { 'User-Agent': 'CCTVPLAN/1.0 (https://cctvplan.axionet.io)' } });
  if (!r.ok) throw new Error('No se pudo geocodificar la dirección');
  const j = await r.json();
  if (!j || !j[0]) { const e = new Error('Dirección no encontrada'); e.code = 'NOT_FOUND'; throw e; }
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

async function geocodeGoogle(direccion) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(direccion) + '&key=' + GOOGLE_MAPS_KEY;
  const r = await fetch(url);
  const j = await r.json();
  if (j.status === 'ZERO_RESULTS') { const e = new Error('Dirección no encontrada'); e.code = 'NOT_FOUND'; throw e; }
  if (j.status !== 'OK' || !j.results[0]) { const e = new Error('Google: ' + (j.error_message || j.status)); e.code = 'GKEY'; throw e; }
  const loc = j.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

// Google Static Maps (satélite | híbrido | callejero)
async function googleSatelite({ direccion, lat, lng, metros, tipo }) {
  if (!(lat && lng)) { const g = await geocodeGoogle(direccion); lat = g.lat; lng = g.lng; }
  let z = Math.round(Math.log2((156543.03392 * Math.cos(lat * D2R) * 640) / metros));
  z = Math.max(1, Math.min(21, z));
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${z}&size=640x640&scale=2&maptype=${tipo}&key=${GOOGLE_MAPS_KEY}`;
  const r = await fetch(url);
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('Google staticmap ' + r.status + ' ' + t.slice(0, 140)); e.code = 'GKEY'; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  const mppEff = mppAt(lat, z) / 2; // scale=2 → el doble de píxeles
  return { imagen: 'data:image/jpeg;base64,' + buf.toString('base64'), w: 1280, h: 1280, pxPerMeter: 1 / mppEff, lat, lng, metros, fuente: 'google' };
}

// Esri por mosaico de tiles (sin API key): imagery (satélite) o street map (callejero)
async function esriSatelite({ direccion, lat, lng, metros, tipo }) {
  if (!(lat && lng)) { const g = await geocodeNominatim(direccion); lat = g.lat; lng = g.lng; }
  const servicio = tipo === 'roadmap' ? 'World_Street_Map' : 'World_Imagery';
  const SIZE = 1024;
  let z = Math.round(Math.log2((156543.03392 * Math.cos(lat * D2R) * SIZE) / metros));
  z = Math.max(1, Math.min(19, z));
  const gx = lngToGlobalX(lng, z), gy = latToGlobalY(lat, z);
  const left = gx - SIZE / 2, top = gy - SIZE / 2;
  const tx0 = Math.floor(left / 256), ty0 = Math.floor(top / 256);
  const tx1 = Math.floor((left + SIZE) / 256), ty1 = Math.floor((top + SIZE) / 256);

  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/${servicio}/MapServer/tile/${z}/${ty}/${tx}`;
    jobs.push(
      fetch(url)
        .then((rr) => (rr.ok ? rr.arrayBuffer() : null))
        .then((ab) => (ab ? { input: Buffer.from(ab), left: (tx - tx0) * 256, top: (ty - ty0) * 256 } : null))
        .catch(() => null)
    );
  }
  const composites = (await Promise.all(jobs)).filter(Boolean);
  if (!composites.length) throw new Error('No se pudieron bajar las imágenes satelitales');

  const canvasW = (tx1 - tx0 + 1) * 256, canvasH = (ty1 - ty0 + 1) * 256;
  const big = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .composite(composites).png().toBuffer();
  const cropLeft = Math.max(0, Math.min(canvasW - SIZE, Math.round(left - tx0 * 256)));
  const cropTop = Math.max(0, Math.min(canvasH - SIZE, Math.round(top - ty0 * 256)));
  const out = await sharp(big).extract({ left: cropLeft, top: cropTop, width: SIZE, height: SIZE }).jpeg({ quality: 85 }).toBuffer();
  return { imagen: 'data:image/jpeg;base64,' + out.toString('base64'), w: SIZE, h: SIZE, pxPerMeter: 1 / mppAt(lat, z), lat, lng, metros, fuente: 'esri' };
}

async function satelite({ direccion, lat, lng, metros, tipo }) {
  metros = Math.min(Math.max(parseInt(metros) || 120, 30), 600);
  tipo = ['satellite', 'hybrid', 'roadmap'].includes(tipo) ? tipo : 'satellite';
  if (GOOGLE_MAPS_KEY) return googleSatelite({ direccion, lat, lng, metros, tipo });
  return esriSatelite({ direccion, lat, lng, metros, tipo });
}

module.exports = { satelite };
