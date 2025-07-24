// src/services/aiService.js
const axios = require('axios');
const config = require('../config');

const OLLAMA_API_URL = config.ollama.url;
const MODEL_NAME = config.ollama.model;

class AIService {
  async rewriteQueryForSearch(userQuery) {
    console.log(`[AIService] Rewriting query: "${userQuery}"`);
    
    // NOUVEAU PROMPT AMÉLIORÉ
    const rewritePrompt = `Your task is to correct spelling mistakes and extract the main keywords from the user's query.
Return ONLY a comma-separated list of these keywords. Do not add any explanation.

**CRITICAL RULE: If the query mentions "school", "university", "this place", "here", or other generic location terms, you MUST add the keyword "nhsm" to the list.**

Example 1:
User Query: "parle moi des specalités dans cette ecole"
Your Response: specialties, nhsm

Example 2:
User Query: "who are the teachers here"
Your Response: professors, nhsm

Example 3:
User Query: "what is the academic structure"
Your Response: academic, structure, nhsm

Example 4:
User Query: "how can i apply for admicion"
Your Response: admissions, apply, nhsm

User Query: "${userQuery}"
Your Response:`;

    const payload = {
      model: MODEL_NAME,
      prompt: rewritePrompt,
      stream: false,
      options: {
        temperature: 0.0, // On veut une réponse déterministe
      }
    };

    try {
      const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, payload, { timeout: 30000 });
      if (response.data && response.data.response) {
        let keywords = response.data.response.trim().toLowerCase();
        // Double sécurité : si l'IA a oublié, on l'ajoute nous-même.
        if (!keywords.includes('nhsm') && (userQuery.includes('school') || userQuery.includes('university') || userQuery.includes('here'))) {
            keywords += ', nhsm';
        }
        console.log(`[AIService] Rewritten keywords: "${keywords}"`);
        return keywords;
      }
      // En cas d'échec, on retourne la query originale nettoyée comme fallback
      return userQuery.toLowerCase().replace(/[^a-z0-9\s,]/g, '');
    } catch (error) {
      console.error(`[AIService] Error rewriting query:`, error.message);
      // Fallback en cas d'erreur
      return userQuery.toLowerCase().replace(/[^a-z0-9\s,]/g, '');
    }
  }

  // src/services/aiService.js

 async filterContext(userQuery, documents) {
        console.log(`[AIService] Filtering ${documents.length} documents for query: "${userQuery}"`);

        const contextToFilter = documents.map((doc, index) => `
<document id="${index}">
<title>${doc.question || 'Info'}</title>
<content>${doc.answer}</content>
</document>`).join('\n');

        const filterPrompt = `You are a relevance filtering expert.
Your task is to identify which of the following documents are highly relevant to answer the user's question.
A document is highly relevant if it DIRECTLY discusses the main topic of the question.

User Question: "${userQuery}"

--- DOCUMENTS ---
${contextToFilter}
--- END DOCUMENTS ---

Instructions:
List ONLY the IDs of the highly relevant documents.
Return a comma-separated list of the document IDs (e.g., "0, 4, 12").
If no documents are relevant, return an empty string.

Relevant Document IDs:`;

        const payload = {
            model: MODEL_NAME, prompt: filterPrompt, stream: false, options: { temperature: 0.0 }
        };

        try {
            const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, payload, { timeout: 60000 });
            const idString = response.data.response.trim().replace(/[^0-9,]/g, ''); // Nettoyer pour ne garder que les chiffres et virgules
            if (idString) {
                const relevantIds = idString.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
                console.log(`[AIService] Found relevant document IDs:`, relevantIds);
                return relevantIds.map(id => documents[id]).filter(Boolean); // Retourner les documents correspondants
            }
            return [];
        } catch (error) {
            console.error(`[AIService] Error filtering context:`, error.message);
            return []; // En cas d'erreur, on ne filtre rien et on continue avec un contexte vide
        }
    }

     async generateResponse(userQuery, context = []) { // On repasse la question originale ici
        console.log(`[AIService] Generating final response for ORIGINAL query: "${userQuery}". Context items: ${context.length}`);
    
        let fullPrompt;

        if (context && context.length > 0) {
            fullPrompt = `You are a helpful and factual assistant for NHSM.
Answer the user's question based ONLY on the provided context. Be comprehensive.

--- CONTEXT ---
${context.map(item => `
## ${item.question || 'Information'}
${item.answer}
`).join('\n')}
--- END CONTEXT ---

User Question: "${userQuery}"

Answer:`;
        } else {
            fullPrompt = `You are a helpful assistant for NHSM.
You could not find any information in your knowledge base for the user's question.
Politely inform the user and answer based on your general knowledge.

User Question: "${userQuery}"

Answer:`;
        }
    
        const payload = { model: MODEL_NAME, prompt: fullPrompt, stream: false, options: { temperature: 0.2 } };
        console.log(`[AIService] Sending final generation prompt (first 300 chars): ${fullPrompt.substring(0, 300)}...`);

        try {
            const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, payload, { timeout: 180000 });
            return response.data.response.trim();
        } catch (error) {
            console.error(`[AIService] Error in final generation:`, error.message);
            return "I'm sorry, an error occurred while generating the final response.";
        }
    }
  }


module.exports = new AIService();