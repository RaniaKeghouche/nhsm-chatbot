// src/controllers/chatController.js
const aiService = require('../services/aiService');
const knowledgeBaseService = require('../services/knowledgeBaseService');

const MAX_CANDIDATES_FOR_FILTERING = 20; // On prend les 20 meilleurs résultats de la recherche pour les faire filtrer par l'IA
const MAX_SOURCES_TO_CLIENT = 5;

class ChatController {
  async processQuery(req, res, next) {
    try {
      const { query } = req.body;
      if (!query) { return res.status(400).json({ success: false, message: 'Query cannot be empty.' }); }

      console.log(`[ChatController] Received raw query: "${query}"`);

      // Étape 1: Réécriture IA pour obtenir des mots-clés propres
      const keywordsString = await aiService.rewriteQueryForSearch(query);
      const keywords = keywordsString.split(',').map(kw => kw.trim()).filter(kw => kw.length > 0);
      console.log(`[ChatController] Using AI-generated keywords for search: ${JSON.stringify(keywords)}`);

      // Étape 2: Recherche large dans la DB pour trouver des candidats
      const candidateDocs = await knowledgeBaseService.findRelevantInfoWithKeywords(keywords);
      const topCandidates = candidateDocs.slice(0, MAX_CANDIDATES_FOR_FILTERING);
      console.log(`[ChatController] Found ${topCandidates.length} candidate documents for AI filtering.`);

      // Étape 3: Filtrage IA pour sélectionner le contexte final
      let finalContext = [];
      if (topCandidates.length > 0) {
        finalContext = await aiService.filterContext(query, topCandidates);
      }
      console.log(`[ChatController] AI filtering resulted in ${finalContext.length} final context items.`);
      
      // Étape 4: Génération de la réponse finale
      const aiAnswer = await aiService.generateResponse(query, finalContext);
      
      const sourcesForClient = finalContext.slice(0, MAX_SOURCES_TO_CLIENT).map(info => ({
        id: info.id || null,
        category: info.category || 'Source',
        title: info.question || `Info: ${info.id}`
      }));

      return res.status(200).json({ success: true, answer: aiAnswer, sources: sourcesForClient });
    } catch (error) {
      console.error('[ChatController] CRITICAL ERROR processing query:', error);
      next(error);
    }
  }
}

module.exports = new ChatController();