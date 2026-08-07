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

  // Erreur par défaut.
  // On ne masque que les 5xx : ce sont eux qui peuvent laisser fuiter une URI
  // Mongo, un chemin de fichier ou une trace interne. Les 4xx sont des refus
  // VOULUS (origine non autorisée, quota, message trop long) : les remplacer
  // par « erreur interne » afficherait un mensonge à l'utilisateur et rendrait
  // le diagnostic impossible en production.
  const status = err.status || 500;
  const isClientError = status >= 400 && status < 500;
  const hideDetails = !isClientError && process.env.NODE_ENV === 'production';

  res.status(status).json({
    success: false,
    message: hideDetails ? 'Une erreur interne est survenue.' : err.message
  });
};

module.exports = errorHandler;