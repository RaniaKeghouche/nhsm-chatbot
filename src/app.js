// src/app.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const config = require('./config/config');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes/api');

const app = express();

// Render/Netlify placent l'app derrière un proxy : nécessaire pour que
// req.ip (et donc le rate limiting) voie la vraie IP du client et non
// celle du proxy — sinon tous les visiteurs partagent le même quota.
app.set('trust proxy', 1);

// ── Sécurité HTTP ──────────────────────────────────────────────────────────
// contentSecurityPolicy désactivé : la page charge marked + Font Awesome
// depuis des CDN, une CSP stricte les bloquerait.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ── CORS : liste blanche au lieu de "tout le monde" ────────────────────────
// Sans ça, n'importe quel site peut appeler l'API et consommer ton quota
// Groq/Cohere. Configurable via ALLOWED_ORIGINS (séparés par des virgules).
const staticOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const originAllowed = (origin) => {
  if (!origin) return true;                      // curl, apps mobiles, same-origin
  if (staticOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      || /^https:\/\/([a-z0-9-]+\.)*netlify\.app$/.test(origin)
      || /^https:\/\/([a-z0-9-]+\.)*onrender\.com$/.test(origin);
};

app.use(cors({
  origin: (origin, cb) => {
    if (originAllowed(origin)) return cb(null, true);
    // Sans status explicite, errorHandler renverrait un 500 « erreur serveur »
    // alors qu'il s'agit d'un refus délibéré.
    const err = new Error(`Origine non autorisée: ${origin}`);
    err.status = 403;
    cb(err);
  },
}));

// ── Parsing ────────────────────────────────────────────────────────────────
// 64 ko suffisent largement (question ≤ 500 car. + historique ≤ 8000 car.).
// L'ancienne limite de 10 Mo permettait de saturer la mémoire du serveur.
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// ── Routes API ─────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Fichiers statiques ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'), (err) => {
    if (err) {
      console.error('[APP] Error serving index.html:', err.message);
      res.status(500).send('Erreur serveur');
    }
  });
});

// ── Health check (utilisé par Render + le ping anti-veille) ────────────────
app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.status(200).json({
    status: 'OK',
    mongo: states[mongoose.connection.readyState] || 'unknown',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use(errorHandler);

module.exports = app;
