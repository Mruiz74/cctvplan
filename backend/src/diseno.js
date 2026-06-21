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
      zonas: {
        type: 'array',
        description: 'Recintos/áreas a vigilar. Para cada uno, su caja (bounding box) y la cámara recomendada. El sistema coloca y orienta la cámara solo.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Nombre del recinto/área (ej: "Oficina", "Acceso principal").' },
            x: { type: 'number', description: 'Esquina sup-izquierda de la caja, 0..1 horizontal.' },
            y: { type: 'number', description: 'Esquina sup-izquierda, 0..1 vertical.' },
            w: { type: 'number', description: 'Ancho de la caja 0..1.' },
            h: { type: 'number', description: 'Alto de la caja 0..1.' },
            modelo_id: { type: 'string', description: 'id EXACTO de una cámara del catálogo.' },
            nivel_dori: { type: 'string', enum: NIVELES },
            motivo: { type: 'string', description: 'Qué cubre y por qué.' },
          },
          required: ['nombre', 'x', 'y', 'w', 'h', 'modelo_id', 'nivel_dori', 'motivo'],
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
    required: ['zonas', 'equipos', 'resumen'],
  },
};

function sistema() {
  return `Eres un experto diseñador de sistemas de videovigilancia (CCTV) en Chile.
Te entregan el PLANO de un sitio (imagen), la escala (px por metro), las MURALLAS detectadas
(segmentos) y un CATÁLOGO de cámaras.
TAREA: identifica los RECINTOS y ÁREAS a vigilar y, para CADA uno, entrega su CAJA (bounding box
x,y,w,h normalizada 0..1 respecto al plano) y la cámara recomendada (modelo del catálogo + nivel
DORI). El sistema colocará y orientará la cámara automáticamente en una esquina del recinto,
mirando hacia el centro, y elegirá la lente para que el cono cubra ese recinto. TÚ no calculas
coordenadas exactas de cámara: solo delimitas el recinto con su caja.
Buenas prácticas:
- UN recinto = UNA cámara (no llenes de cámaras). Identifica cada sala/oficina/pasillo/acceso real.
- Cubre cada ACCESO/puerta con nivel "identificar"; pasillos con "reconocer"; áreas amplias con
  "observar" o "detectar".
- Las cajas deben corresponder a recintos REALES del plano (apóyate en las murallas). NO cubras el
  exterior del edificio, ni el cuadro de título/notas/leyenda del plano.
- Usa SOLO modelos del catálogo (modelo_id exacto). Domo para interior, bullet para exterior,
  PTZ para grandes áreas/patios.
- REGLA DE MARCA: un sistema CCTV usa UNA SOLA marca (un grabador/VMS, un esquema de licencias,
  compatibilidad). NO mezcles marcas salvo que se permita explícitamente.
Responde SIEMPRE llamando a la herramienta proponer_diseno. Sé práctico, no sobre-dimensiones.`;
}

async function autoDiseno({ imagenDataUrl, brief, pxPerMeter, planoW, planoH, catalogo, marcaPreferida, muros }) {
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

  let marcaTxt;
  if (marcaPreferida && marcaPreferida !== 'auto' && marcaPreferida !== 'mezclar') {
    marcaTxt = `Usa EXCLUSIVAMENTE cámaras de la marca "${marcaPreferida}".`;
  } else if (marcaPreferida === 'mezclar') {
    marcaTxt = 'Se permite mezclar marcas solo si lo justificas claramente.';
  } else {
    marcaTxt = 'Usa UNA SOLA marca para todo el sistema (elige la más adecuada del catálogo). NO mezcles marcas.';
  }

  content.push({
    type: 'text',
    text: `ENCARGO: ${brief || 'Diseña una cobertura CCTV completa y razonable para este plano.'}\n` +
      `MARCA: ${marcaTxt}\n` +
      `ESCALA: ${pxPerMeter ? pxPerMeter.toFixed(1) + ' px/m' : 'no calibrada'}. PLANO: ${planoW}x${planoH}px.\n` +
      `MURALLAS DETECTADAS (segmentos normalizados x1,y1,x2,y2): ${JSON.stringify((muros || []).slice(0, 200))}\n` +
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

// ─── Detección de murallas con IA ────────────────────────────────────────────
const TOOL_RECINTOS = {
  name: 'reportar_recintos',
  description: 'Lista los recintos (salas, oficinas, pasillos, bodegas) del plano como cajas rectangulares.',
  input_schema: {
    type: 'object',
    properties: {
      recintos: {
        type: 'array',
        description: 'Cada recinto es una caja en coordenadas normalizadas 0..1 (x,y = esquina sup-izq).',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string' },
            x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          },
          required: ['x', 'y', 'w', 'h'],
        },
      },
    },
    required: ['recintos'],
  },
};

async function detectarMuros({ imagenDataUrl }) {
  const m = imagenDataUrl && /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imagenDataUrl);
  if (!m) { const e = new Error('Falta el plano'); e.code = 'NO_IMG'; throw e; }
  const client = getClient();
  let buf = Buffer.from(m[2], 'base64');
  try { buf = await sharp(buf).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); } catch {}
  const cuerpo = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: `Analizas planos arquitectónicos. Identifica los RECINTOS reales delimitados por murallas (salas, oficinas, pasillos, bodegas, baños). Para cada uno entrega su CAJA rectangular (x,y = esquina sup-izquierda, w,h) en coordenadas normalizadas 0..1 (x: izq→der, y: arriba→abajo), ajustada a las paredes del recinto. NO incluyas el exterior del edificio, ni el cuadro de título/notas/leyenda, ni muebles ni cotas. Responde SIEMPRE con la herramienta reportar_recintos.`,
    tools: [TOOL_RECINTOS],
    tool_choice: { type: 'tool', name: 'reportar_recintos' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
      { type: 'text', text: 'Detecta los recintos (salas/oficinas/pasillos) de este plano como cajas.' },
    ] }],
  };
  let ultimo;
  for (let i = 1; i <= 3; i++) {
    try {
      const msg = await client.messages.create(cuerpo);
      const tu = msg.content.find((b) => b.type === 'tool_use');
      if (!tu || !tu.input) throw new Error('Sin resultado');
      return Array.isArray(tu.input.recintos) ? tu.input.recintos : [];
    } catch (e) { ultimo = e; if (!esConexion(e) || i === 3) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
  throw ultimo;
}

module.exports = { autoDiseno, detectarMuros };
