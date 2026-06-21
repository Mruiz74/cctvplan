'use strict';
// Lee la ficha técnica (datasheet) de UNA cámara IP con Claude visión y devuelve
// sus especificaciones en el esquema del catálogo. Salida forzada por tool-use.
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

const TOOL = {
  name: 'registrar_camara',
  description: 'Registra las especificaciones de UNA cámara CCTV leídas de su datasheet.',
  input_schema: {
    type: 'object',
    properties: {
      marca: { type: 'string', description: 'Fabricante (ej: Hikvision, Dahua, Axis, Hanwha).' },
      modelo: { type: 'string', description: 'Modelo/SKU lo más exacto posible (ej: DS-2CD2143G2-IS).' },
      tipo: { type: 'string', description: 'bullet | turret | dome | ptz | multisensor | fisheye' },
      mp: { type: 'number', description: 'Megapíxeles. Si es 4MP, pon 4.' },
      resolucion_w: { type: 'number', description: 'Ancho máximo en píxeles (ej 2688). Si no aparece, estímalo desde los MP.' },
      resolucion_h: { type: 'number', description: 'Alto máximo en píxeles (ej 1520).' },
      sensor_formato: { type: 'string', description: 'Formato del sensor como fracción de pulgada SOLAMENTE, ej "1/2.8", "1/3", "1/1.8" (sin la palabra inch/pulgada).' },
      lente_tipo: { type: 'string', description: 'fija | varifocal | motorizada_varifocal | ptz_zoom' },
      lentes: {
        type: 'array',
        description: 'Opciones de lente. Si es fija con 1 focal → un item. Si es varifocal/zoom → el extremo gran-angular (focal mínima) y el tele (focal máxima). hfov_publicado_deg = ángulo HORIZONTAL en grados de esa focal SI aparece en el datasheet; si no, omítelo.',
        items: {
          type: 'object',
          properties: {
            focal_mm: { type: 'number' },
            hfov_publicado_deg: { type: 'number', description: 'Ángulo horizontal en grados, solo si aparece.' },
          },
          required: ['focal_mm'],
        },
      },
      ir_alcance_m: { type: 'number', description: 'Alcance IR en metros si lo indica.' },
      ip_rating: { type: 'string', description: 'ej IP67.' },
      ik_rating: { type: 'string', description: 'ej IK10.' },
      poe: { type: 'boolean', description: 'true si soporta PoE.' },
      caracteristicas: { type: 'array', items: { type: 'string' }, description: '2 a 4 características clave (ej AcuSense, ColorVu, WDR 120dB).' },
      confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Qué tan claros estaban los datos en el documento.' },
    },
    required: ['marca', 'modelo', 'tipo', 'mp', 'sensor_formato', 'lente_tipo', 'lentes', 'poe', 'caracteristicas', 'confianza'],
  },
};

const SISTEMA = [
  'Eres un ingeniero de CCTV. Te dan la ficha técnica (datasheet) de UNA cámara IP.',
  'Extrae sus especificaciones y regístralas con la herramienta registrar_camara.',
  'Reglas estrictas:',
  '- sensor_formato: SOLO la fracción de pulgada, ej "1/2.8".',
  '- lentes: si es varifocal o zoom, entrega el extremo gran-angular (focal mínima) y el tele (focal máxima). Si es fija, una sola.',
  '- hfov_publicado_deg: usa el ángulo HORIZONTAL (Horizontal FOV) en grados que aparezca para esa focal. Si no aparece, omítelo. NO inventes ángulos.',
  '- Si un dato no aparece, omítelo (o estima resolucion_w/h desde los MP, 16:9 o 4:3 según corresponda).',
  '- Si el documento no es un datasheet de cámara, igual intenta, pero marca confianza "baja".',
].join('\n');

async function comprimir(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || '');
  if (!m) { const e = new Error('Imagen inválida'); e.code = 'NO_IMG'; throw e; }
  const buf = Buffer.from(m[2], 'base64');
  const out = await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return out.toString('base64');
}

async function extraerDatasheet({ imagenDataUrl }) {
  if (!imagenDataUrl) { const e = new Error('Sube el datasheet'); e.code = 'NO_IMG'; throw e; }
  const client = getClient();
  const data = await comprimir(imagenDataUrl);
  const intento = () => client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    system: SISTEMA,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'registrar_camara' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: 'Extrae las especificaciones de esta cámara desde su datasheet.' },
      ],
    }],
  });
  let resp;
  try { resp = await intento(); }
  catch (e) { if (esConexion(e)) resp = await intento(); else throw e; }
  const tu = resp.content.find((c) => c.type === 'tool_use');
  if (!tu) throw new Error('No se pudo leer el datasheet');
  return tu.input;
}

module.exports = { extraerDatasheet };
