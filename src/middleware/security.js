// src/middleware/security.js
const rateLimit = require('express-rate-limit');

// ⚠️ Attention au NAT : sur le réseau du campus, tous les étudiants peuvent
// sortir avec la MÊME IP publique et donc partager le même quota. D'où une
// valeur réglable sans redéploiement via RATE_LIMIT_MAX.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQ   = parseInt(process.env.RATE_LIMIT_MAX, 10) || 30;

const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQ,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Limite de requêtes atteinte. Réessayez dans 15 minutes.'
  }
});

// Rate limiter spécial pour les gros messages
const sizeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: parseInt(process.env.RATE_LIMIT_LONG_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  // req.body peut être absent si le parsing JSON a échoué → optional chaining
  skip: (req) => !req.body?.query || req.body.query.length < 200,
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

  // 🛡️ VALIDATION DE L'HISTORIQUE DE CONVERSATION (#5)
  // L'historique est optionnel, mais s'il est présent il doit être raisonnable
  const { history } = req.body;
  if (history !== undefined) {
    if (!Array.isArray(history) || history.length > 12) {
      console.warn(`[SECURITY] Invalid history from IP ${req.ip}`);
      return res.status(400).json({ success: false, message: 'Historique invalide.' });
    }
    const totalSize = history.reduce((sum, m) =>
      sum + (m && typeof m.content === 'string' ? m.content.length : 0), 0);
    if (totalSize > 8000) {
      console.warn(`[SECURITY] Oversized history blocked: ${totalSize} chars from IP ${req.ip}`);
      return res.status(400).json({ success: false, message: 'Historique trop volumineux.' });
    }
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
// ⚠️ Inclut l'arabe (؀-ۿ), les chiffres et la ponctuation courante
// — sinon les questions en arabe/derdja seraient bloquées comme "nonsense" !
function detectNonsense(text) {
  const chars = text.toLowerCase();
  const totalChars = chars.length;

  // Compter les caractères qui ne sont ni lettres (latin/arabe), ni chiffres,
  // ni ponctuation normale
  const nonAlphaCount = (chars.match(/[^a-zA-Z0-9àâäéèêëïîôöùûüÿçœæ؀-ۿ\s'’?,.!;:()\-]/g) || []).length;

  return nonAlphaCount / totalChars;
}

module.exports = {
  apiLimiter,
  sizeLimiter,
  validateQuery
};