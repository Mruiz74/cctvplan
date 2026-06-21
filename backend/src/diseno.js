'use strict';
// Auto-diseño con Claude (visión + razonamiento). Recibe el plano y el catálogo,
// devuelve una propuesta de cámaras (ubicación normalizada, modelo, orientación,
// nivel DORI) + equipos recomendados. Salida forzada por tool-use.
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = require('./config');

let _client = null;
function getClient() {
  if (!ANTHROPIC_API_KEY) { const e = new Error('Falta ANTHROPIC_API_KEY'); e.code = 'NO_API_KEY'; throw e; }
  if (!_client) _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 4, timeout: 120000 });
  return _client;
}
const esConexion = (e) => !e?.status && /premature close|fetch failed|econnreset|socket hang up|terminated|other side closed|network|timeout/i.test(String(e?.message || e));

const NIVELES = ['identificar', 'reconocer', 'observar', 'detectar'];

const TOOL = {
  name: 'proponer_diseno',
  description: 'Propone la ubicación de cámaras CCTV sobre el plano y los equipos necesarios.',
  input_schema: {
    type: 'object',
    properties: {
      camaras: {
        type: 'array',
        description: 'Cámaras propuestas. Coordenadas normalizadas 0..1 respecto al plano (x: izq→der, y: arriba→abajo).',
        items: {
          type: 'object',
          properties: {
            modelo_id: { type: 'string', description: 'id EXACTO de una cámara del catálogo entregado.' },
            x: { type: 'number', description: '0..1 horizontal' },
            y: { type: 'number', description: '0..1 vertical' },
            rot_deg: { type: 'number', description: 'Orientación en grados. 0=derecha/este, 90=abajo, 180=izquierda, 270=arriba.' },
            lente_idx: { type: 'integer', description: 'Índice de la lente del modelo (0 = primera).' },
            nivel_dori: { type: 'string', enum: NIVELES },
            motivo: { type: 'string', description: 'Justificación breve (qué cubre).' },
          },
          required: ['modelo_id', 'x', 'y', 'rot_deg', 'lente_idx', 'nivel_dori', 'motivo'],
        },
      },
      equipos: {
        type: 'array',
        items: {
          type: 'object',
          properties: { tipo: { type: 'string' }, descripcion: { type: 'string' }, cantidad: { type: 'integer' } },
          required: ['tipo', 'descripcion', 'cantidad'],
        },
      },
      resumen: { type: 'string', description: 'Resumen del diseño y recomendaciones.' },
    },
    required: ['camaras', 'equipos', 'resumen'],
  },
};

function sistema() {
  return `Eres un experto diseñador de sistemas de videovigilancia (CCTV) en Chile.
Te entregan el PLANO de un sitio (imagen), opcionalmente la escala (px por metro) y un
CATÁLOGO de cámaras disponibles. Diseña la ubicación de cámaras cumpliendo buenas prácticas:
- Cubre TODOS los accesos/puertas con nivel "identificar" (rostro/patente).
- Pasillos y áreas de tránsito con "reconocer".
- Áreas amplias/perímetros con "observar" o "detectar".
- Evita zonas ciegas; orienta cada cámara hacia lo que debe cubrir.
- Usa SOLO modelos del catálogo (modelo_id exacto). Elige el tipo adecuado (domo interior,
  bullet exterior, PTZ para grandes áreas) y la lente apropiada (lente_idx).
- Coordenadas normalizadas 0..1 respecto al plano. Orientación: 0=este, 90=sur, 180=oeste, 270=norte.
Responde SIEMPRE llamando a la herramienta proponer_diseno. Sé práctico y no sobre-dimensiones.`;
}

async function autoDiseno({ imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo }) {
  const client = getClient();
  const content = [];

  if (imagenDataUrl) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imagenDataUrl);
    if (m) {
      let buf = Buffer.from(m[2], 'base64');
      try { buf = await sharp(buf).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); } catch {}
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });
    }
  }

  const cat = (catalogo || []).map((c) => ({
    id: c.id, marca: c.marca, modelo: c.modelo, tipo: c.tipo, mp: c.mp,
    lentes: (c.lentes || []).map((l, i) => ({ idx: i, focal_mm: l.focal_mm, hfov: l.hfov_publicado_deg })),
  }));

  content.push({
    type: 'text',
    text: `ENCARGO: ${brief || 'Diseña una cobertura CCTV completa y razonable para este plano.'}\n` +
      `ESCALA: ${pxPerMeter ? pxPerMeter.toFixed(1) + ' px/m' : 'no calibrada'}. PLANO: ${planoW}x${planoH}px.\n` +
      `CATÁLOGO DISPONIBLE (usa estos modelo_id):\n${JSON.stringify(cat)}`,
  });

  const cuerpo = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: sistema(),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'proponer_diseno' },
    messages: [{ role: 'user', content }],
  };

  let ultimo;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const msg = await client.messages.create(cuerpo);
      const tu = msg.content.find((b) => b.type === 'tool_use');
      if (!tu || !tu.input) throw new Error('La IA no devolvió un diseño.');
      return tu.input;
    } catch (e) {
      ultimo = e;
      if (!esConexion(e) || intento === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * intento));
    }
  }
  throw ultimo;
}

module.exports = { autoDiseno };
