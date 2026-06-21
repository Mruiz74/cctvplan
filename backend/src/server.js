'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PORT, FRONTEND_URL } = require('./config');
const { autoDiseno, detectarMuros } = require('./diseno');
const { satelite } = require('./satelite');
const { extraerDatasheet } = require('./datasheet');
const { pool, init } = require('./db');
const { hash, verify, makeToken, requireAuth } = require('./auth');

const app = express();
const allow = FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allow.length ? allow : true }));
app.use(express.json({ limit: '14mb' })); // el plano viaja en base64

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'CCTVPLAN IA' }));

app.post('/api/autodiseno', async (req, res) => {
  const { imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo, marcaPreferida, muros } = req.body || {};
  if (!catalogo || !Array.isArray(catalogo) || catalogo.length === 0) {
    return res.status(400).json({ error: 'Falta el catálogo de cámaras' });
  }
  try {
    const diseno = await autoDiseno({ imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo, marcaPreferida, muros });
    res.json(diseno);
  } catch (e) {
    if (e.code === 'NO_API_KEY') return res.status(503).json({ error: 'La IA no está configurada en el servidor (falta ANTHROPIC_API_KEY).' });
    if (e.status === 401) return res.status(401).json({ error: 'API key de Claude inválida.' });
    console.error('autodiseno:', e.status || '', e.message || e);
    res.status(500).json({ error: 'No se pudo generar el diseño con IA. Reintenta.' });
  }
});

app.post('/api/muros', async (req, res) => {
  try {
    const recintos = await detectarMuros({ imagenDataUrl: (req.body || {}).imagenDataUrl });
    res.json({ recintos });
  } catch (e) {
    if (e.code === 'NO_API_KEY') return res.status(503).json({ error: 'La IA no está configurada (falta ANTHROPIC_API_KEY).' });
    if (e.code === 'NO_IMG') return res.status(400).json({ error: 'Sube un plano primero.' });
    if (e.status === 401) return res.status(401).json({ error: 'API key de Claude inválida.' });
    console.error('muros:', e.status || '', e.message || e);
    res.status(500).json({ error: 'No se pudieron detectar las murallas.' });
  }
});

app.post('/api/satelite', async (req, res) => {
  const { direccion, lat, lng, metros, tipo } = req.body || {};
  if (!direccion && !(lat && lng)) return res.status(400).json({ error: 'Ingresa una dirección.' });
  try {
    res.json(await satelite({ direccion, lat, lng, metros, tipo }));
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'No encontré esa dirección. Prueba con más detalle (calle, número, comuna, país).' });
    if (e.code === 'GKEY') { console.error('satelite google:', e.message || e); return res.status(502).json({ error: 'La API de Google Maps rechazó la solicitud (revisa la API key, que tenga Static Maps + Geocoding habilitadas y facturación).' }); }
    console.error('satelite:', e.message || e);
    res.status(500).json({ error: 'No se pudo obtener la imagen satelital. Reintenta.' });
  }
});

app.post('/api/datasheet', async (req, res) => {
  try {
    const camara = await extraerDatasheet({ imagenDataUrl: (req.body || {}).imagenDataUrl });
    res.json({ camara });
  } catch (e) {
    if (e.code === 'NO_API_KEY') return res.status(503).json({ error: 'La IA no está configurada (falta ANTHROPIC_API_KEY).' });
    if (e.code === 'NO_IMG') return res.status(400).json({ error: 'Sube el datasheet (PDF o imagen).' });
    if (e.status === 401) return res.status(401).json({ error: 'API key de Claude inválida.' });
    console.error('datasheet:', e.status || '', e.message || e);
    res.status(500).json({ error: 'No se pudo leer el datasheet. Prueba con una imagen más nítida o solo la página de especificaciones.' });
  }
});

// ---------- Cuentas y proyectos en la nube ----------
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'El guardado en la nube no está configurado en el servidor.' });
  const nombre = (req.body?.nombre || '').trim();
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  if (!nombre) return res.status(400).json({ error: 'Ingresa tu nombre.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Email inválido.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, nombre, password_hash) VALUES ($1, $2, $3) RETURNING id, email, nombre',
      [email, nombre, hash(password)]
    );
    res.json({ token: makeToken(rows[0]), user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese email ya está registrado. Inicia sesión.' });
    console.error('register:', e); res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  }
});

app.post('/api/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'El guardado en la nube no está configurado en el servidor.' });
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  try {
    const { rows } = await pool.query('SELECT id, email, nombre, password_hash FROM users WHERE email = $1', [email]);
    const u = rows[0];
    if (!u || !verify(password, u.password_hash)) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    res.json({ token: makeToken(u), user: { id: u.id, email: u.email, nombre: u.nombre } });
  } catch (e) { console.error('login:', e); res.status(500).json({ error: 'No se pudo iniciar sesión.' }); }
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Lista (sin el data pesado)
app.get('/api/proyectos', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, actualizado_en FROM proyectos WHERE user_id = $1 ORDER BY actualizado_en DESC',
      [req.user.id]
    );
    res.json({ proyectos: rows });
  } catch (e) { console.error('lista:', e); res.status(500).json({ error: 'No se pudieron listar los proyectos.' }); }
});

// Abrir uno (con el data completo)
app.get('/api/proyectos/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nombre, data FROM proyectos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    res.json({ proyecto: rows[0] });
  } catch (e) { console.error('abrir:', e); res.status(500).json({ error: 'No se pudo abrir el proyecto.' }); }
});

// Crear
app.post('/api/proyectos', requireAuth, async (req, res) => {
  const nombre = (req.body?.nombre || '').trim() || 'Proyecto sin nombre';
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Faltan datos del proyecto.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO proyectos (user_id, nombre, data) VALUES ($1, $2, $3) RETURNING id, nombre, actualizado_en',
      [req.user.id, nombre, data]
    );
    res.json({ proyecto: rows[0] });
  } catch (e) { console.error('crear:', e); res.status(500).json({ error: 'No se pudo guardar el proyecto.' }); }
});

// Actualizar (guardar cambios)
app.put('/api/proyectos/:id', requireAuth, async (req, res) => {
  const nombre = (req.body?.nombre || '').trim() || 'Proyecto sin nombre';
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Faltan datos del proyecto.' });
  try {
    const { rows } = await pool.query(
      'UPDATE proyectos SET nombre = $1, data = $2, actualizado_en = now() WHERE id = $3 AND user_id = $4 RETURNING id, nombre, actualizado_en',
      [nombre, data, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    res.json({ proyecto: rows[0] });
  } catch (e) { console.error('actualizar:', e); res.status(500).json({ error: 'No se pudo guardar el proyecto.' }); }
});

// Borrar
app.delete('/api/proyectos/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM proyectos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    res.json({ ok: true });
  } catch (e) { console.error('borrar:', e); res.status(500).json({ error: 'No se pudo borrar el proyecto.' }); }
});

init().catch((e) => console.error('init DB:', e.message || e));
app.listen(PORT, () => console.log(`🧠 CCTVPLAN IA escuchando en puerto ${PORT}`));
