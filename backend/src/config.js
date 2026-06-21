'use strict';
require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT || '4100'),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  // Opus 4.8: mejor razonamiento + visión para diseñar la cobertura.
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  // Orígenes permitidos (coma). Vacío = todos (restríngelo en producción).
  FRONTEND_URL: process.env.FRONTEND_URL || '',
  // Guardado de proyectos en la nube (login propio + Neon Postgres).
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || 'cctvplan-dev-secret-cambiar',
  JWT_EXPIRES: process.env.JWT_EXPIRES || '30d',
  // Imagen satelital: si está, usa Google Static Maps; si no, Esri (gratis).
  GOOGLE_MAPS_KEY: process.env.GOOGLE_MAPS_KEY || '',
};
