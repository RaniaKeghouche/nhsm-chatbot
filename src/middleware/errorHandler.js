// src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Erreurs MongoDB
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    return res.status(500).json({
      success: false,
      message: 'Erreur de base de données.'
    });
  }

  // Erreurs de validation
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Données invalides.',
      details: Object.values(err.errors).map(e => e.message)
    });
  }

  // Erreur par défaut
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Une erreur interne est survenue.' 
      : err.message
  });
};

module.exports = errorHandler;