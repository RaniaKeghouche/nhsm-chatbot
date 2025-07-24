// src/services/aiService.js
const Groq = require('groq-sdk');
const config = require('../config');

// On définit les modèles ici
const REWRITE_MODEL = 'llama3-8b-8192';
const FILTER_MODEL = 'llama3-8b-8192';
const GENERATE_MODEL = 'llama3-8b-8192';

// Fonction utilitaire qui gère l'initialisation et l'appel
async function makeGroqRequest(prompt, model, temperature) {
    if (!config.groqApiKey) {
        const errorMessage = 'GROQ_API_KEY is missing. Please check your .env file or environment variables.';
        console.error(`[AIService] ERROR: ${errorMessage}`);
        throw new Error(errorMessage);
    }
    const groq = new Groq({ apiKey: config.groqApiKey });
    
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: model,
            temperature: temperature,
        });
        return chatCompletion.choices[0]?.message?.content || '';
    } catch (error) {
        console.error(`[AIService] Groq API call failed for model ${model}:`, error.message);
        throw error;
    }
}

class AIService {
  async rewriteQueryForSearch(userQuery) {
    console.log(`[AIService] Rewriting query with Groq: "${userQuery}"`);
    const rewritePrompt = `Your task is to correct spelling mistakes and extract the main keywords from the user's query. Return ONLY a comma-separated list of these keywords. Do not add any explanation. CRITICAL RULE: If the query mentions "school", "university", "this place", "here", or other generic location terms, you MUST add the keyword "nhsm" to the list.

    Example 1: User Query: "parle moi des specalités dans cette ecole" -> Your Response: specialties, nhsm
    Example 2: User Query: "who are the teachers here" -> Your Response: professors, nhsm
    
    User Query: "${userQuery}"
    Your Response:`;

    try {
        const keywords = await makeGroqRequest(rewritePrompt, REWRITE_MODEL, 0.0);
        console.log(`[AIService] Rewritten keywords: "${keywords}"`);
        return keywords.toLowerCase();
    } catch (error) {
        console.error(`[AIService] Failed to rewrite query. Falling back to basic processing.`);
        return userQuery.toLowerCase().replace(/[^a-z0-9\s,]/g, '');
    }
  }

  async filterContext(userQuery, documents) {
    if (!documents || documents.length === 0) return [];
    
    console.log(`[AIService] Filtering ${documents.length} documents with Groq for query: "${userQuery}"`);
    const contextToFilter = documents.map((doc, index) => `<document id="${index}"><title>${doc.question || 'Info'}</title><content>${doc.answer}</content></document>`).join('\n');
    const filterPrompt = `You are a relevance filtering expert. Your task is to identify which of the following documents are highly relevant to answer the user's question. A document is highly relevant if it DIRECTLY discusses the main topic of the question.

    User Question: "${userQuery}"
    
    --- DOCUMENTS ---
    ${contextToFilter}
    --- END DOCUMENTS ---
    
    Instructions: List ONLY the IDs of the highly relevant documents. Return a comma-separated list of the document IDs (e.g., "0, 4, 12"). If no documents are relevant, return an empty string.
    
    Relevant Document IDs:`;

    try {
        const idString = await makeGroqRequest(filterPrompt, FILTER_MODEL, 0.0);
        const cleanedIdString = idString.replace(/[^0-9,]/g, '');
        
        if (cleanedIdString) {
            const relevantIds = cleanedIdString.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
            console.log(`[AIService] Groq found relevant document IDs:`, relevantIds);
            return relevantIds.map(id => documents[id]).filter(Boolean);
        }
        return [];
    } catch (error) {
        console.error(`[AIService] Failed to filter context.`);
        return [];
    }
  }

  async generateResponse(userQuery, context = []) {
    console.log(`[AIService] Generating final response with Groq for query: "${userQuery}". Context items: ${context.length}`);
    let fullPrompt;

    if (context && context.length > 0) {
        fullPrompt = `You are a helpful and factual assistant for NHSM. Answer the user's question based ONLY on the provided context. Be comprehensive.
        
        --- CONTEXT ---
        ${context.map(item => `## ${item.question || 'Information'}\n${item.answer}`).join('\n\n')}
        --- END CONTEXT ---
        
        User Question: "${userQuery}"
        
        Answer:`;
    } else {
        fullPrompt = `You are a helpful assistant for NHSM. You could not find any information in your knowledge base for the user's question. Politely inform the user and answer based on your general knowledge.
        
        User Question: "${userQuery}"
        
        Answer:`;
    }

    try {
        const answer = await makeGroqRequest(fullPrompt, GENERATE_MODEL, 0.2);
        console.log('[AIService] Groq final response:', answer.substring(0, 150) + "...");
        return answer;
    } catch (error) {
        console.error(`[AIService] Failed to generate final response.`);
        return "I'm sorry, I encountered a technical problem while trying to generate a response.";
    }
  }
}

module.exports = new AIService();