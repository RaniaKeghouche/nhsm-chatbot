// src/server.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); // S'assurer que .env est chargé depuis la racine

const mongoose = require('mongoose');
const app = require('./app'); // Importe l'application Express configurée depuis app.js (notre Étape 2)
const config = require('./config'); // Importe la configuration centralisée

const PORT = config.port || 5000; // Utilise le port de la config ou 5000 par défaut

// Connexion MongoDB
if (!config.mongoURI) {
  console.error('FATAL ERROR: MONGO_URI is not defined in .env or config.');
  process.exit(1);
}
// Petit log pour masquer les credentials complets
const mongoLogURI = config.mongoURI.includes('@') ? config.mongoURI.substring(0, config.mongoURI.indexOf('@')) + '@...' : config.mongoURI;
console.log(`Attempting to connect to MongoDB at ${mongoLogURI}`);

mongoose.connect(config.mongoURI) // Pas besoin des options dépréciées pour Mongoose 6+
.then(() => {
  console.log('MongoDB connecté avec succès.');
  // Lancer le serveur seulement après une connexion MongoDB réussie
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
    console.log(`Accéder au chat sur http://localhost:${PORT}/`);
    console.log(`Point d'API du chat : POST http://localhost:${PORT}/api/query`);
  });
})
.catch((err) => {
  console.error('Erreur de connexion MongoDB:', err.message);
  process.exit(1);
});