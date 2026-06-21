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
- COLOCACIÓN realista: ubica cada cámara en una ESQUINA o borde del recinto, montada en muro/cielo,
  ORIENTADA HACIA el interior del recinto o el área a vigilar. NUNCA la orientes hacia afuera del
  edificio ni contra un muro pegado. Apunta hacia la diagonal del recinto para cubrir más.
- Una cámara por recinto/área relevante (no llenes de cámaras). Cubre cada PUERTA/acceso con
  "identificar"; pasillos con "reconocer"; áreas amplias con "observar".
- Elige la LENTE según el tamaño del recinto: recintos chicos → gran angular (focal corta, no
  sobredimensiones el alcance); pasillos largos → focal más larga (más alcance). El cono NO debe
  salirse del edificio.
- Usa las MURALLAS entregadas (coordenadas) para entender los recintos y orientar correctamente.
- REGLA DE MARCA (buenas prácticas): un sistema CCTV usa UNA SOLA marca, porque cada marca
  implica su propio grabador/VMS y su esquema de licencias, y mezclar pierde las analíticas/IA
  por compatibilidad. NO mezcles marcas salvo que se permita explícitamente.
Responde SIEMPRE llamando a la herramienta proponer_diseno. Sé práctico y no sobre-dimensiones.`;
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
const TOOL_MUROS = {
  name: 'reportar_muros',
  description: 'Lista los segmentos de muralla/pared detectados en el plano.',
  input_schema: {
    type: 'object',
    properties: {
      muros: {
        type: 'array',
        description: 'Cada muro es un segmento recto en coordenadas normalizadas 0..1.',
        items: {
          type: 'object',
          properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } },
          required: ['x1', 'y1', 'x2', 'y2'],
        },
      },
    },
    required: ['muros'],
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
    system: `Analizas planos arquitectónicos. Identifica las MURALLAS/paredes: el perímetro del edificio y las divisiones internas principales. Devuelve cada muro como un segmento recto (x1,y1,x2,y2) en coordenadas normalizadas 0..1 (x: izq→der, y: arriba→abajo). NO incluyas cotas/medidas, texto, muebles ni símbolos; deja vanos donde hay puertas. Une los tramos en líneas rectas. Responde SIEMPRE con la herramienta reportar_muros.`,
    tools: [TOOL_MUROS],
    tool_choice: { type: 'tool', name: 'reportar_muros' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
      { type: 'text', text: 'Detecta las murallas de este plano.' },
    ] }],
  };
  let ultimo;
  for (let i = 1; i <= 3; i++) {
    try {
      const msg = await client.messages.create(cuerpo);
      const tu = msg.content.find((b) => b.type === 'tool_use');
      if (!tu || !tu.input) throw new Error('Sin resultado');
      return Array.isArray(tu.input.muros) ? tu.input.muros : [];
    } catch (e) { ultimo = e; if (!esConexion(e) || i === 3) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
  throw ultimo;
}

module.exports = { autoDiseno, detectarMuros };
