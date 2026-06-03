// src/app.js - Version simplifiée pour démarrer
const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes/api');

const app = express();
const port = 3001;

// Middlewares de base
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Log général
app.use((req, res, next) => {
    console.log(`[APP] ${req.method} ${req.url}`);
    next();
});

// Routes API
app.use('/api', apiRoutes);

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, '../public')));

// Route racine
app.get('/', (req, res) => {
  console.log('[APP] Serving index.html...');
  const filePath = path.join(__dirname, '../public/index.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[APP] Error serving index.html:', err);
      res.status(500).send('Erreur serveur');
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Gestionnaire d'erreur
app.use(errorHandler);

// Démarrer le serveur si exécuté directement
if (require.main === module) {
    app.listen(port, () => {
        console.log(`[APP] Serveur lancé sur http://localhost:${port}`);
    });
}

module.exports = app;