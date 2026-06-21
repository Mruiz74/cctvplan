'use strict';
const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

if (!DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL no definido — el guardado de proyectos en la nube no funcionará (la IA y el satélite sí).');
}

const esLocal = DATABASE_URL && /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: esLocal ? false : { rejectUnauthorized: false }, max: 5 })
  : null;

// Crea las tablas si no existen (idempotente).
async function init() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      nombre        TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS proyectos (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre        TEXT NOT NULL,
      data          JSONB NOT NULL,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_proyectos_user ON proyectos(user_id);
  `);
}

module.exports = { pool, init };
