// ===== 3. CHATCONTROLLER AVEC STREAMING - src/controllers/chatController.js =====
const aiService = require('../services/aiService');
const knowledgeBaseService = require('../services/knowledgeBaseService');

const MAX_SOURCES_TO_CLIENT = 5;

// En-têtes de la réponse en flux.
//
// `text/event-stream` est le point CRITIQUE en production, et il n'est pas
// cosmétique : Render sert ses services derrière Cloudflare, qui met en tampon
// les réponses `text/plain` et ne les relâche qu'une fois terminées. Mesuré sur
// la même question : 62 morceaux en local contre 2 à travers Render, premier
// octet à 1,8 s contre 8,9 s — l'étudiant fixait un écran figé puis recevait
// tout d'un coup, et l'endpoint streaming n'apportait donc rien.
// Cloudflare laisse passer `text/event-stream` sans tampon : c'est le TYPE DE
// CONTENU qui décide, pas `X-Accel-Buffering` (que le proxy supprime au
// passage — vérifié, il n'arrive jamais au client).
//
// Le client lit les octets bruts via response.body.getReader() et ne se sert
// pas d'EventSource : le format du corps reste inchangé, seul l'en-tête bascule.
const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// ── Greetings & social phrases that need NO DB lookup ──────────────────────
const GREETING_PATTERNS = [
  /^(hi+|hey+|hello+|salut+|bonjour+|bonsoir+|salam+|السلام|مرحبا|اهلا|آهلاً|coucou|yo+|wesh+|wsh|ola|hola|slt|bjr|cc)[\s!?.]*$/i,
  /^(merci|thanks|thank you|شكرا|شكراً|barak allahu|merci beaucoup)[\s!?.]*$/i,
  /^(ok|okay|good|bien|super|parfait|d'accord|dac|ouais|oui|yes|no|non|nope|sure)[\s!?.]*$/i,
  /^[\s!?.😊👋🤝]+$/,   // just emoji/punctuation
];

function isGreeting(query) {
  const q = query.trim();
  if (q.length === 0) return true;
  // Very short message (≤ 4 chars) with no real content
  if (q.length <= 4 && !/[a-zA-Z\u0600-\u06FF]{3,}/.test(q)) return true;
  return GREETING_PATTERNS.some(p => p.test(q));
}

// ── #5 : Nettoyage de l'historique envoyé par le client ────────────────────
// On ne fait JAMAIS confiance au client : types vérifiés, tailles bornées.
function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory
    .filter(m => m && typeof m === 'object' && typeof m.content === 'string' && m.content.trim().length > 0)
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content.trim().substring(0, 600),
    }))
    .slice(-6); // seulement les 6 derniers messages
}

// ── Greeting responses (multilingual) ──────────────────────────────────────
function greetingResponse(query) {
  const q = query.trim().toLowerCase();
  const isArabic = /[\u0600-\u06FF]/.test(q);
  const isFrench = /^(salut|bonjour|bonsoir|slt|bjr|coucou|merci|ouais|oui|dac|super|parfait|bien)/.test(q);
  const isThanks = /thank|merci|شكر/.test(q);
  const isOk = /^(ok|okay|oui|ouais|yes|good|bien|dac|super)/.test(q);

  if (isArabic) return "أهلاً وسهلاً! 👋 أنا NHSM Helper، مساعدك الخاص لطلاب المدرسة الوطنية العليا للرياضيات. كيف يمكنني مساعدتك اليوم؟";
  if (isThanks) return isFrench
    ? "De rien ! 😊 N'hésitez pas si vous avez d'autres questions sur l'NHSM."
    : "You're welcome! 😊 Feel free to ask me anything else about NHSM.";
  if (isOk) return isFrench
    ? "Parfait ! N'hésitez pas à poser votre prochaine question. 😊"
    : "Great! Let me know if you have any other questions. 😊";
  if (isFrench) return "Bonjour ! 👋 Je suis NHSM Helper. Comment puis-je vous aider aujourd'hui ?\n\nVous pouvez me poser des questions sur :\n- 🎓 Les spécialités (SESA, CCS, MS)\n- 👨‍🏫 Les professeurs\n- 📚 Les méthodes d'étude\n- 🏫 La vie étudiante à l'NHSM";
  return "Hello! 👋 I'm NHSM Helper. How can I help you today?\n\nYou can ask me about:\n- 🎓 Specialties (SESA, CCS, MS)\n- 👨‍🏫 Professors at NHSM\n- 📚 Study methods & tips\n- 🏫 Student life at NHSM";
}

class ChatController {
  // Réponse streaming
  async processQueryStream(req, res, next) {
    const startTime = Date.now();
    const { query } = req.body;
    const history = sanitizeHistory(req.body.history);

    try {
      console.log(`[ChatController] Processing streamed query: "${query.substring(0, 50)}..." (history: ${history.length} msgs)`);

      // ── Fast-path: greetings bypass DB entirely ─────────────────────────
      if (isGreeting(query)) {
        const reply = greetingResponse(query);
        res.writeHead(200, STREAM_HEADERS);
        res.write('SOURCES:[]\n\n');
        res.write(reply);
        res.write(`\n\nPROCESSING_TIME:1ms`);
        return res.end();
      }

      // ── #5 : résoudre les questions de suivi ("et pour SESA ?") ─────────
      const standaloneQuery = await aiService.condenseConversationalQuery(history, query);

      console.log('[ChatController] Rewriting query for keywords...');
      const keywordsString = await aiService.rewriteQueryForSearch(standaloneQuery);
      const keywords = keywordsString.split(',').map(kw => kw.trim()).filter(kw => kw.length > 0);
      console.log(`[ChatController] Keywords extracted: ${keywords.join(', ')}`);

      console.log('[ChatController] Searching knowledge base...');
      const candidateDocs = await knowledgeBaseService.findRelevantInfoWithKeywords(keywords, standaloneQuery);
      console.log(`[ChatController] Found ${candidateDocs.length} candidate documents`);
      
      // Use top KB results — expand limit for list-type queries
      const contextLimit = candidateDocs.length > 10 ? 15 : MAX_SOURCES_TO_CLIENT;
      const finalContext = candidateDocs
        .filter(doc => {
          const ans = (doc.answer || '').toLowerCase();
          return !ans.startsWith('currently no available') && !ans.startsWith('no information');
        })
        .slice(0, contextLimit);
      
      console.log(`[ChatController] Final context: ${finalContext.length} documents for AI`);
      
      const sourcesForClient = finalContext.slice(0, MAX_SOURCES_TO_CLIENT).map(info => ({
        id: info.id || null,
        category: info.category || 'Source',
        title: info.question || `Info: ${info.id}`
      }));

      // Configuration du streaming
      res.writeHead(200, STREAM_HEADERS);

      // Envoyer les sources d'abord
      res.write(`SOURCES:${JSON.stringify(sourcesForClient)}\n\n`);
      
      // Stream de la réponse (question autonome + historique pour la cohérence)
      console.log('[ChatController] Starting Groq streaming...');
      const stream = await aiService.generateResponseStream(standaloneQuery, finalContext, history);
      console.log('[ChatController] Groq stream received, iterating...');
      
      let chunkCount = 0;
      for await (const chunk of stream) {
        if (chunk.choices?.[0]?.delta?.content) {
          res.write(chunk.choices[0].delta.content);
          chunkCount++;
        }
      }
      
      console.log(`[ChatController] Stream completed. Chunks received: ${chunkCount}`);
      const processingTime = Date.now() - startTime;
      res.write(`\n\nPROCESSING_TIME:${processingTime}ms`);
      res.end();
      
    } catch (error) {
      console.error('[ChatController] Streaming error:', error.message);
      if (!res.headersSent) {
        next(error);
      } else {
        // Les en-têtes sont partis : impossible de changer le code HTTP,
        // on ne peut plus qu'écrire du texte dans le flux déjà ouvert.
        const message = error.isRateLimit
          ? aiService.rateLimitReply(query)
          : 'Une erreur est survenue lors de la génération de la réponse.';
        res.write(`\n\n${message}`);
        res.end();
      }
    }
  }

  // Réponse normale (fallback)
  async processQuery(req, res, next) {
    const startTime = Date.now();
    const { query } = req.body;
    const history = sanitizeHistory(req.body.history);

    try {
      console.log(`[ChatController] Processing query: "${query.substring(0, 50)}..." (history: ${history.length} msgs)`);

      // ── Fast-path: greetings bypass DB entirely ─────────────────────────
      if (isGreeting(query)) {
        const reply = greetingResponse(query);
        return res.status(200).json({ success: true, answer: reply, sources: [], processingTime: 1 });
      }

      // ── #5 : résoudre les questions de suivi ("et pour SESA ?") ─────────
      const standaloneQuery = await aiService.condenseConversationalQuery(history, query);

      const keywordsString = await aiService.rewriteQueryForSearch(standaloneQuery);
      const keywords = keywordsString.split(',').map(kw => kw.trim()).filter(kw => kw.length > 0);

      const candidateDocs = await knowledgeBaseService.findRelevantInfoWithKeywords(keywords, standaloneQuery);

      // Use top KB results directly — for list queries return more docs
      const contextLimit = candidateDocs.length > 10 ? 15 : MAX_SOURCES_TO_CLIENT;
      const finalContext = candidateDocs
        .filter(doc => {
          const ans = (doc.answer || '').toLowerCase();
          return !ans.startsWith('currently no available') && !ans.startsWith('no information');
        })
        .slice(0, contextLimit);

      const aiAnswer = await aiService.generateResponse(standaloneQuery, finalContext, history);
      
      const sourcesForClient = finalContext.slice(0, MAX_SOURCES_TO_CLIENT).map(info => ({
        id: info.id || null,
        category: info.category || 'Source',
        title: info.question || `Info: ${info.id}`
      }));

      const processingTime = Date.now() - startTime;
      console.log(`[ChatController] Query processed in ${processingTime}ms`);

      return res.status(200).json({ 
        success: true, 
        answer: aiAnswer, 
        sources: sourcesForClient,
        processingTime 
      });

    } catch (error) {
      console.error('[ChatController] Error processing query:', error);
      next(error);
    }
  }
}

module.exports = new ChatController();
