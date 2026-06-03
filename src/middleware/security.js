// src/middleware/security.js
const rateLimit = require('express-rate-limit');

// Rate limiting BEAUCOUP plus strict
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Seulement 20 requêtes max (au lieu de 50)
  message: {
    success: false,
    message: 'Limite de requêtes atteinte. Réessayez dans 15 minutes.'
  }
});

// Rate limiter spécial pour les gros messages
const sizeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Seulement 5 gros messages
  skip: (req) => req.body.query && req.body.query.length < 200,
  message: {
    success: false,
    message: 'Trop de messages longs. Attendez 5 minutes.'
  }
});

const validateQuery = (req, res, next) => {
  const { query } = req.body;
  
  if (!query || typeof query !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Query invalide.'
    });
  }
  
  // 🚨 LIMITE DRASTIQUEMENT RÉDUITE (500 au lieu de 1000)
  if (query.length > 500) {
    console.warn(`[SECURITY] Oversized message blocked: ${query.length} chars from IP ${req.ip}`);
    return res.status(400).json({
      success: false,
      message: 'Message trop long (max 500 caractères).'
    });
  }
  
  // 🛡️ DÉTECTION DE SPAM par répétition
  const repetitionRatio = detectRepetition(query);
  if (repetitionRatio > 0.7) { // Plus de 70% de répétition = spam
    console.warn(`[SECURITY] Spam detected: ${repetitionRatio} repetition ratio`);
    return res.status(400).json({
      success: false,
      message: 'Message suspect détecté (répétitions excessives).'
    });
  }
  
  // 🔍 DÉTECTION DE CARACTÈRES NONSENSE
  const nonsenseRatio = detectNonsense(query);
  if (nonsenseRatio > 0.8) {
    console.warn(`[SECURITY] Nonsense detected: ${nonsenseRatio} ratio`);
    return res.status(400).json({
      success: false,
      message: 'Message incohérent détecté.'
    });
  }
  
  next();
};

// Fonction pour détecter les répétitions excessives
function detectRepetition(text) {
  const words = text.toLowerCase().split(/\s+/);
  if (words.length < 5) return 0;
  
  const wordCount = {};
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });
  
  const totalWords = words.length;
  const uniqueWords = Object.keys(wordCount).length;
  const maxRepetition = Math.max(...Object.values(wordCount));
  
  // Si un mot apparaît plus de 50% du temps = spam
  return maxRepetition / totalWords;
}

// Fonction pour détecter le nonsense
function detectNonsense(text) {
  const chars = text.toLowerCase();
  const totalChars = chars.length;
  
  // Compter les caractères non-alphabétiques
  const nonAlphaCount = (chars.match(/[^a-zA-Zàâäéèêëïîôöùûüÿç\s]/g) || []).length;
  
  return nonAlphaCount / totalChars;
}

module.exports = {
  apiLimiter,
  sizeLimiter,
  validateQuery
};