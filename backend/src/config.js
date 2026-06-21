'use strict';
require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT || '4100'),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  // Opus 4.8: mejor razonamiento + visión para diseñar la cobertura.
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  // Orígenes permitidos (coma). Vacío = todos (restríngelo en producción).
  FRONTEND_URL: process.env.FRONTEND_URL || '',
};
