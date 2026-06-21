'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PORT, FRONTEND_URL } = require('./config');
const { autoDiseno, detectarMuros } = require('./diseno');

const app = express();
const allow = FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allow.length ? allow : true }));
app.use(express.json({ limit: '14mb' })); // el plano viaja en base64

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'CCTVPLAN IA' }));

app.post('/api/autodiseno', async (req, res) => {
  const { imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo, marcaPreferida } = req.body || {};
  if (!catalogo || !Array.isArray(catalogo) || catalogo.length === 0) {
    return res.status(400).json({ error: 'Falta el catálogo de cámaras' });
  }
  try {
    const diseno = await autoDiseno({ imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo, marcaPreferida });
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
    const muros = await detectarMuros({ imagenDataUrl: (req.body || {}).imagenDataUrl });
    res.json({ muros });
  } catch (e) {
    if (e.code === 'NO_API_KEY') return res.status(503).json({ error: 'La IA no está configurada (falta ANTHROPIC_API_KEY).' });
    if (e.code === 'NO_IMG') return res.status(400).json({ error: 'Sube un plano primero.' });
    if (e.status === 401) return res.status(401).json({ error: 'API key de Claude inválida.' });
    console.error('muros:', e.status || '', e.message || e);
    res.status(500).json({ error: 'No se pudieron detectar las murallas.' });
  }
});

app.listen(PORT, () => console.log(`🧠 CCTVPLAN IA escuchando en puerto ${PORT}`));
