// src/server.js - Version corrigée

const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (err) {
  console.warn('DNS warning:', err.message);
}

const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config'); // Chemin corrigé

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

// Connexion MongoDB avec gestion d'erreur améliorée
mongoose.connect(config.mongoURI)
.then(() => {
  console.log('✅ MongoDB connecté avec succès.');
  
  // Lancer le serveur seulement après une connexion MongoDB réussie
  app.listen(PORT, () => {
    console.log(`🚀 Serveur NHSM Helper lancé sur http://localhost:${PORT}`);
    console.log(`💬 Accéder au chat sur http://localhost:${PORT}/`);
    console.log(`🔗 API endpoint: POST http://localhost:${PORT}/api/query`);
    console.log(`📡 Streaming endpoint: POST http://localhost:${PORT}/api/query-stream`);
    console.log(`Environment: ${config.nodeEnv}`);
  });
})
.catch((err) => {
  console.error('❌ Erreur de connexion MongoDB:', err.message);
  console.error('Vérifiez que MongoDB est en cours d\'exécution et que MONGO_URI est correct.');
  process.exit(1);
});

// Gestion propre de l'arrêt
process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  try {
    await mongoose.connection.close();
    console.log('📦 Connexion MongoDB fermée.');
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de la fermeture:', error.message);
    process.exit(1);
  }
});