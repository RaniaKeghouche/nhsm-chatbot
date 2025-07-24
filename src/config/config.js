// src/config/config.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') }); // Spécifier le chemin vers .env

module.exports = {
  mongoURI: process.env.MONGO_URI || 'mongodb+srv://student:mydatabase%401010@cluster0.yadjqvd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  // aiModel: process.env.AI_MODEL || 'Xenova/mistral-7b-instruct-v0.2-q4_0', // Semble être pour un usage différent, conservez si besoin
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000, // Assurez-vous que port est un nombre

  ollama: { // Regrouper les configurations Ollama
    url: process.env.OLLAMA_API_URL || 'http://localhost:11434', // URL de base SANS /api
    model: process.env.OLLAMA_MODEL || 'mistral'
  },

  huggingface: { // Regrouper les configurations Hugging Face
    apiToken: process.env.HUGGINGFACE_API_TOKEN,
    model: process.env.HF_MODEL_NAME || 'mistralai/Mistral-7B-Instruct-v0.2' // Modèle HF par défaut
  }
};