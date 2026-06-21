'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { JWT_SECRET, JWT_EXPIRES } = require('./config');

function hash(pw) { return bcrypt.hashSync(pw, 10); }
function verify(pw, h) { return bcrypt.compareSync(pw, h); }

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function requireAuth(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'El guardado en la nube no está configurado en el servidor.' });
  const h = req.headers.authorization;
  const token = h && h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token inválido o expirado' }); }
  pool.query('SELECT id, email, nombre FROM users WHERE id = $1', [payload.id])
    .then(({ rows }) => {
      if (!rows[0]) return res.status(401).json({ error: 'Sesión inválida' });
      req.user = rows[0];
      next();
    })
    .catch((e) => { console.error('requireAuth:', e); res.status(500).json({ error: 'Error de autenticación' }); });
}

module.exports = { hash, verify, makeToken, requireAuth };
