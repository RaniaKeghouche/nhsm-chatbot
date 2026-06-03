// src/services/aiService.js - Version corrigée
const Groq = require('groq-sdk');
const config = require('../config/config'); // Chemin corrigé

const REWRITE_MODEL = 'llama-3.1-8b-instant';
const FILTER_MODEL = 'llama-3.1-8b-instant';
const GENERATE_MODEL = 'llama-3.1-8b-instant';

async function makeGroqRequest(prompt, model, temperature, stream = false) {
  if (!config.groqApiKey) {
    const errorMessage = 'GROQ_API_KEY is missing. Please check your .env file.';
    console.error(`[AIService] ERROR: ${errorMessage}`);
    throw new Error(errorMessage);
  }
  const groq = new Groq({ apiKey: config.groqApiKey });

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: model,
      temperature: temperature,
      stream: stream
    });

    if (stream) {
      return chatCompletion;
    }

    return chatCompletion.choices[0]?.message?.content || '';
  } catch (error) {
    console.error(`[AIService] Groq API call failed for model ${model}:`, error.message);
    throw error;
  }
}

class AIService {
  async rewriteQueryForSearch(userQuery) {
    console.log(`[AIService] Rewriting query with Groq: "${userQuery}"`);
    const rewritePrompt = `Your task is to extract the main keywords and key concepts from the user's query to search a database.
Generate a comprehensive, comma-separated list of keywords. 
To ensure maximum search coverage:
1. Translate key concepts into both English and French (e.g., "spécialités" -> "specialties, specialities, spécialités"; "modules" -> "modules, courses, curriculum").
2. Include common synonyms and spelling variations.
3. If the query mentions "school", "university", "this place", "here", "ecole", or Algerian slang for school/university (like "ليكول", "المدرسة", "ليكول"), you MUST add the keyword "nhsm".
4. For Arabic or Algerian Derdja queries, translate the concepts into English AND French keywords only — do NOT output Arabic characters in the keyword list.
5. Return ONLY the comma-separated list, with no intro or explanation.

Example 1: User Query: "parle moi des specalités dans cette ecole" -> Your Response: specialties, specialities, spécialités, nhsm
Example 2: User Query: "who are the teachers here" -> Your Response: teachers, professors, enseignants, nhsm
Example 3: User Query: "les modules de chaque année" -> Your Response: modules, courses, curriculum, years, années, nhsm
Example 4: User Query: "وش هوما تخصصات لي كاينين ف ليكول" -> Your Response: specialties, specialities, spécialités, nhsm
Example 5: User Query: "شكون هو أحسن أستاذ في المدرسة" -> Your Response: teachers, professors, enseignants, best, nhsm
    
    User Query: "${userQuery}"
    Your Response:`;

    try {
      const keywords = await makeGroqRequest(rewritePrompt, REWRITE_MODEL, 0.0);
      console.log(`[AIService] Rewritten keywords: "${keywords}"`);
      return keywords.toLowerCase();
    } catch (error) {
      console.error(`[AIService] Failed to rewrite query. Falling back to basic processing.`, error);
      return userQuery.toLowerCase().replace(/[^a-z0-9\s,]/g, '');
    }
  }

  async filterContext(userQuery, documents, keywords = []) {
    if (!documents || documents.length === 0) return [];

    console.log(`[AIService] Filtering ${documents.length} documents with improved algorithm`);

    const queryForScoring = keywords && keywords.length > 0 ? keywords.join(' ') : userQuery;

    // 🎯 SCORING AMÉLIORÉ avec vérification de pertinence
    const scoredDocs = documents.map((doc, index) => {
      const relevanceScore = this.calculateDetailedRelevance(queryForScoring, doc);
      return { ...doc, index, relevanceScore };
    });

    // Garder seulement les documents avec un score > 0.1
    const relevantDocs = scoredDocs.filter(doc => doc.relevanceScore > 0.1);

    if (relevantDocs.length === 0) {
      console.log('[AIService] No relevant documents found after filtering');
      return [];
    }

    // Trier par pertinence et prendre les 3 meilleurs
    relevantDocs.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topDocs = relevantDocs.slice(0, 3);

    console.log(`[AIService] Filtered to ${topDocs.length} highly relevant documents`);
    return topDocs;
  }

  calculateDetailedRelevance(query, doc) {
    const queryWords = query.toLowerCase().split(/\s+/);
    const docText = `${doc.question || ''} ${doc.answer || ''}`.toLowerCase();
    const docTags = (doc.tags || []).join(' ').toLowerCase();

    let score = 0;
    let matchedWords = 0;

    queryWords.forEach(word => {
      if (word.length < 3) return; // Ignorer les mots trop courts

      // Expand word to its stem variants (singular/plural)
      const stems = [word];
      if (word.endsWith('ies')) stems.push(word.slice(0, -3) + 'y');
      else if (word.endsWith('y')) stems.push(word.slice(0, -1) + 'ies');
      if (word.endsWith('s') && word.length > 4) stems.push(word.slice(0, -1));
      else if (word.length > 3) stems.push(word + 's');

      const matched = stems.some(stem => docText.includes(stem) || docTags.includes(stem));
      if (!matched) return;

      // Correspondance exacte dans la question (poids fort)
      if (doc.question && stems.some(stem => doc.question.toLowerCase().includes(stem))) {
        score += 10;
        matchedWords++;
      }

      // Correspondance dans les tags (poids moyen)
      if (stems.some(stem => docTags.includes(stem))) {
        score += 5;
        matchedWords++;
      }

      // Correspondance dans la réponse (poids faible)
      if (doc.answer && stems.some(stem => doc.answer.toLowerCase().includes(stem))) {
        score += 2;
        matchedWords++;
      }
    });

    // Bonus si plusieurs mots correspondent
    if (matchedWords > 1) {
      score *= 1.5;
    }

    // Normaliser le score (0-1) — diviseur fixe pour éviter la dilution
    return Math.min(score / 20, 1);
  }

  _detectQueryLanguage(query) {
    const totalNonSpace = query.replace(/\s/g, '').length || 1;
    const arabicChars  = (query.match(/[\u0600-\u06FF]/g) || []).length;
    const arabicRatio  = arabicChars / totalNonSpace;

    // Only classify as Arabic if >50% of chars are Arabic
    // This prevents "C'est quoi 'الحفلة'?" from being classified as Arabic
    if (arabicRatio > 0.50) return 'Algerian Derdja or Arabic';

    const frWords = ['le ','la ','les ','de ','du ','des ','est ','sont ','je ','vous ',
                     'nous ','comment ','quoi ','quel ','quelle ','quels ',"c'est ",
                     "qu'est",'parle ','expli','donnes'];
    const enWords = ['the ','is ','are ','what ','how ','who ','does ','can ','do ',
                     'give ','list ','describe ','tell ','explain '];
    const ql = query.toLowerCase();
    const frCount = frWords.filter(w => ql.includes(w)).length;
    const enCount = enWords.filter(w => ql.includes(w)).length;
    if (frCount > enCount) return 'French';
    if (enCount > frCount) return 'English';
    // Short messages like 'hii', 'wesh' — default to French (NHSM is French-speaking)
    if (query.trim().length < 10) return 'French';
    return 'the same language as the question';
  }

  async generateResponse(userQuery, context = []) {
    console.log(`[AIService] Generating final response with Groq for query: "${userQuery}". Context items: ${context.length}`);
    const detectedLang = this._detectQueryLanguage(userQuery);

    const SYSTEM_RULES = this._buildSystemRules(detectedLang);
    const fullPrompt   = this._buildPrompt(SYSTEM_RULES, userQuery, context, detectedLang);

    try {
      const answer = await makeGroqRequest(fullPrompt, GENERATE_MODEL, 0.1);
      console.log('[AIService] Groq final response:', answer.substring(0, 150) + '...');
      return answer;
    } catch (error) {
      console.error('[AIService] Failed to generate final response.', error);
      return "Je suis désolé, une erreur technique s'est produite. Veuillez réessayer.";
    }
  }

  async generateResponseStream(userQuery, context = []) {
    console.log(`[AIService] Generating streaming response with Groq for query: "${userQuery}". Context items: ${context.length}`);
    const detectedLang = this._detectQueryLanguage(userQuery);

    const SYSTEM_RULES = this._buildSystemRules(detectedLang);
    const fullPrompt   = this._buildPrompt(SYSTEM_RULES, userQuery, context, detectedLang);

    try {
      const stream = await makeGroqRequest(fullPrompt, GENERATE_MODEL, 0.1, true);
      return stream;
    } catch (error) {
      console.error(`[AIService] Failed to generate streaming response.`, error);
      throw error;
    }
  }
}

module.exports = new AIService();