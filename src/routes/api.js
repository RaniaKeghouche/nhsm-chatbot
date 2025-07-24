// src/routes/api.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController'); // Assure-toi que le chemin est bon

// Route pour traiter les requêtes de chat
// Sera accessible via POST /api/query
router.post('/query', (req, res, next) => {
  console.log('[Routes/api.js] POST /query hit. Query:', req.body.query);
  chatController.processQuery(req, res, next).catch(next);
});

module.exports = router;