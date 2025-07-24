// src/app.js (Étape 3 : Ajout des routes API)
console.log('--- Début du script app.js (Étape 3) ---');

const express = require('express');
const path = require('path');
const cors = require('cors'); // Ajout de CORS
const morgan = require('morgan'); // Ajout de Morgan (logger HTTP)
const apiRoutes = require('./routes/api'); // Importe tes routes API

const app = express();
const port = 3001; // Pour les tests isolés avec 'node app.js'
                   // Sera ignoré si server.js utilise son propre port (ex: 5000)

// Middlewares de base
app.use(cors()); // Permettre les requêtes cross-origin
app.use(express.json({ limit: '10mb' })); // Pour parser les corps de requête JSON
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev')); // Logger les requêtes HTTP dans la console

// Middleware pour log général (celui que tu avais ou celui-ci)
app.use((req, res, next) => {
    console.log(`[APP ÉTAPE 3] Middleware général - Méthode: ${req.method}, URL: ${req.url}`);
    next();
});

// IMPORTANT : Monter les routes API AVANT les routes de service de fichiers statiques
// si les routes API pourraient avoir des noms conflictuels avec des noms de fichiers.
// Dans notre cas, /api ne conflit pas avec /, donc l'ordre est moins critique
// mais c'est une bonne pratique de les mettre avant les gestionnaires de fichiers plus généraux.
console.log('[APP ÉTAPE 3] Montage des routes API sous /api...');
app.use('/api', apiRoutes); // Tes routes API seront préfixées par /api

// Servir les fichiers statiques (si chat.html a des CSS/JS externes dans public/)
// Tu peux aussi le mettre avant les routes API si tu préfères.
app.use(express.static(path.join(__dirname, '../public')));

// Route racine pour servir l'interface de chat (chat.html)
app.get('/', (req, res) => {
  console.log('[APP ÉTAPE 3] Reached / route! Tentative d\'envoyer chat.html...');
  const filePath = path.join(__dirname, '../public/chat.html');
  console.log(`[APP ÉTAPE 3] Chemin du fichier à envoyer : ${filePath}`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[APP ÉTAPE 3] Erreur lors de l\'envoi de chat.html:', err);
      if (!res.headersSent) {
        res.status(500).send(`Erreur serveur : Impossible de charger la page de chat. Détail : ${err.message}`);
      }
    } else {
      console.log('[APP ÉTAPE 3] chat.html envoyé avec succès.');
    }
  });
});

// Gestionnaire d'erreur global (DOIT ÊTRE LE DERNIER APP.USE)
app.use((err, req, res, next) => {
  console.error('[APP ÉTAPE 3] Erreur globale attrapée:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Une erreur interne est survenue.',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Démarrer le serveur si ce fichier est exécuté directement
if (require.main === module) {
    console.log('[APP ÉTAPE 3] require.main === module est VRAI. Tentative de démarrage du serveur...');
    app.listen(port, () => {
        console.log(`[APP ÉTAPE 3] Serveur lancé sur http://localhost:${port}`);
        console.log(`---> Teste l'interface sur http://localhost:${port}/`);
        console.log(`---> Le point d'API est POST http://localhost:${port}/api/query`);
    });
} else {
    console.log('[APP ÉTAPE 3] require.main === module est FAUX (importé par server.js).');
}

console.log('--- Fin du script app.js (Étape 3) ---');
module.exports = app;
console.log('--- app.js (Étape 3) : module.exports exécuté ---');