// ===== 4. ROUTES API AMÉLIORÉES - src/routes/api.js =====
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

// Route streaming
router.post('/query-stream', (req, res, next) => {
  console.log('[Routes/api.js] POST /query-stream hit');
  chatController.processQueryStream(req, res, next).catch(next);
});

// Route normale (fallback)
router.post('/query', (req, res, next) => {
  console.log('[Routes/api.js] POST /query hit');
  chatController.processQuery(req, res, next).catch(next);
});

module.exports = router;