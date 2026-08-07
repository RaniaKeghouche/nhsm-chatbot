// src/server.js - Version corrigée

// Beaucoup de FAI ne résolvent pas les enregistrements SRV exigés par
// mongodb+srv:// — d'où ce résolveur public par défaut.
// Sur un hébergeur dont le DNS interne fonctionne (Render, Docker), mettre
// SKIP_PUBLIC_DNS=1 pour laisser le résolveur de la plateforme faire son travail.
const dns = require('dns');
if (process.env.SKIP_PUBLIC_DNS !== '1') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  } catch (err) {
    console.warn('DNS warning:', err.message);
  }
}

const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config'); // Chemin corrigé
const knowledgeBaseService = require('./services/knowledgeBaseService');

const PORT = config.port || 5000;

// Vérification des variables d'environnement critiques
if (!config.mongoURI) {
  console.error('FATAL ERROR: MONGO_URI is not defined in .env file.');
  console.error('Please create a .env file with MONGO_URI=your_mongodb_connection_string');
  process.exit(1);
}

if (!config.groqApiKey) {
  console.error('WARNING: GROQ_API_KEY is not defined in .env file.');
  console.error('The AI features will not work without this key.');
}

// Log de connexion (masquer les credentials)
const mongoLogURI = config.mongoURI.includes('@') 
  ? config.mongoURI.substring(0, config.mongoURI.indexOf('@')) + '@...' 
  : config.mongoURI;
console.log(`Attempting to connect to MongoDB at ${mongoLogURI}`);

let server;

// Connexion MongoDB avec tentatives échelonnées.
// ⚠️ Auparavant, un seul échec suffisait à faire process.exit(1) — et donc à
// faire ÉCHOUER le déploiement Render. Un cluster Atlas en veille met plusieurs
// dizaines de secondes à se réveiller : c'est ce qui a fait tomber le déploiement
// du 17/07/2026. On réessaie avant d'abandonner.
const MAX_DB_ATTEMPTS = 5;
const RETRY_DELAY_MS  = 5000;

async function connectWithRetry() {
  for (let attempt = 1; attempt <= MAX_DB_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(config.mongoURI, { serverSelectionTimeoutMS: 15000 });
      console.log('✅ MongoDB connecté avec succès.');
      return;
    } catch (err) {
      const last = attempt === MAX_DB_ATTEMPTS;
      console.error(`❌ MongoDB tentative ${attempt}/${MAX_DB_ATTEMPTS} échouée: ${err.message}`);
      if (last) throw err;
      console.log(`   Nouvelle tentative dans ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

connectWithRetry()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`🚀 Serveur NHSM Helper lancé sur http://localhost:${PORT}`);
      console.log(`💬 Accéder au chat sur http://localhost:${PORT}/`);
      console.log(`🔗 API endpoint: POST http://localhost:${PORT}/api/query`);
      console.log(`📡 Streaming endpoint: POST http://localhost:${PORT}/api/query-stream`);
      console.log(`Environment: ${config.nodeEnv}`);

      // Préchauffage du cache vectoriel EN ARRIÈRE-PLAN : le port est déjà
      // ouvert, donc Render voit le service en ligne pendant le chargement.
      knowledgeBaseService.warmUp();
    });
  })
  .catch((err) => {
    console.error('❌ Connexion MongoDB impossible après plusieurs tentatives:', err.message);
    console.error('Vérifiez que le cluster Atlas est actif et que MONGO_URI est correct.');
    console.error('Si le cluster était en pause, il peut mettre ~1 min à démarrer — relancez le déploiement.');
    process.exit(1);
  });

// Arrêt propre.
// ⚠️ Render (comme Docker/Kubernetes) envoie SIGTERM, pas SIGINT : seul
// SIGINT était écouté, donc en production les connexions n'étaient jamais
// fermées proprement lors d'un redéploiement.
const shutdown = async (signal) => {
  console.log(`\n🛑 ${signal} reçu — arrêt du serveur...`);
  try {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.close();
    console.log('📦 Connexion MongoDB fermée.');
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de la fermeture:', error.message);
    process.exit(1);
  }
};

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));