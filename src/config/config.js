// src/config/config.js

// ON MET LA LIGNE ICI. CE FICHIER SERA LE PREMIER A CHARGER .ENV
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

module.exports = {
  // --- Configuration principale ---
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  mongoURI: process.env.MONGO_URI, // On lit directement process.env

  // --- Configuration du service IA (Groq) ---
  groqApiKey: process.env.GROQ_API_KEY,

  // --- Configuration Cohere (embeddings) ---
  cohereApiKey: process.env.COHERE_API_KEY,
};