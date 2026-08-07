// src/routes/api.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { validateQuery, apiLimiter, sizeLimiter } = require('../middleware/security');

// Ordre volontaire : quota global → quota messages longs → validation du contenu.
// Les limiteurs existaient déjà mais n'étaient montés NULLE PART : l'API était
// ouverte, et chaque requête déclenche 2 à 3 appels Groq + 1 Cohere (coût réel).
router.post('/query-stream', apiLimiter, sizeLimiter, validateQuery, (req, res, next) => {
  chatController.processQueryStream(req, res, next).catch(next);
});

router.post('/query', apiLimiter, sizeLimiter, validateQuery, (req, res, next) => {
  chatController.processQuery(req, res, next).catch(next);
});

module.exports = router;
