'use strict';
// Imagen satelital por dirección. Geocodifica con Nominatim (OSM, gratis) y trae
// la foto aérea de Esri World Imagery (gratis, sin API key). Devuelve la imagen y
// px/m REAL (calculado del área cubierta), así la escala queda calibrada sola.

async function geocode(direccion) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(direccion);
  const r = await fetch(url, { headers: { 'User-Agent': 'CCTVPLAN/1.0 (https://cctvplan.axionet.io)' } });
  if (!r.ok) throw new Error('No se pudo geocodificar la dirección');
  const j = await r.json();
  if (!j || !j[0]) { const e = new Error('Dirección no encontrada'); e.code = 'NOT_FOUND'; throw e; }
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

async function satelite({ direccion, lat, lng, metros }) {
  metros = Math.min(Math.max(parseInt(metros) || 120, 30), 600); // lado del área, en metros
  if (!(lat && lng)) { const g = await geocode(direccion); lat = g.lat; lng = g.lng; }

  const size = 1024;
  const dLat = (metros / 2) / 111320;
  const dLng = (metros / 2) / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
  const url = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${size},${size}&format=jpg&f=image`;

  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudo obtener la imagen satelital');
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    imagen: 'data:image/jpeg;base64,' + buf.toString('base64'),
    w: size, h: size,
    pxPerMeter: size / metros,
    lat, lng, metros,
  };
}

module.exports = { satelite };
