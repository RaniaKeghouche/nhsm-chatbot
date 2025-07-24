// src/services/huggingfaceService.js
const { HfInference } = require('@huggingface/inference');
const config = require('../config'); // Charger la configuration centralisée

// Initialize Hugging Face client with API token
if (!config.huggingface.apiToken && process.env.NODE_ENV !== 'test') { // Ne pas bloquer pour les tests si token non défini
  console.warn('[HuggingFaceService] HUGGINGFACE_API_TOKEN is not set. HuggingFaceService will likely fail.');
  // throw new Error('HUGGINGFACE_API_TOKEN is not set in environment variables.'); // Décommenter pour bloquer
}
const hf = new HfInference(config.huggingface.apiToken);
const HF_MODEL_NAME = config.huggingface.model;

/**
 * AI Service for handling interactions with the Hugging Face Inference API
 */
class HuggingFaceService {
  /**
   * Generate a response from the AI model
   * @param {string} query - The user's question
   * @param {Array<Object>} context - Optional context from database. Each object should have `question` and `answer`.
   * @returns {Promise<string>} - The AI model's response
   */
  async generateResponse(query, context = []) {
    try {
      // Basic system prompt to guide the AI's behavior
      let systemPrompt = `Tu es NHSM Helper, un assistant IA spécialisé dans l'aide aux étudiants en mathématiques et techniques d'étude.
Tu es serviable, amical et compétent.
Quand tu ne connais pas la réponse, tu le dis honnêtement.
Sois toujours concis et donne des conseils pratiques.
Réponds toujours en français.`; // Assurez-vous que le modèle HF gère bien le français ou adaptez le prompt

      // If we have context from the database, add it to the prompt
      if (context && context.length > 0) {
        systemPrompt += `\n\nVoici des informations pertinentes qui pourraient aider à répondre à la question de l'utilisateur ("${query}"):\n`;
        context.forEach(item => {
          if (item && item.question && item.answer) {
            systemPrompt += `INFORMATION CONTEXTUELLE:\nQuestion: ${item.question}\nRéponse: ${item.answer}\n---\n`;
          } else {
            console.warn('[HuggingFaceService] Context item has unexpected structure:', item);
          }
        });
        systemPrompt += "\nUtilise ces informations pour formuler ta réponse à la question de l'utilisateur.\n";
      }

      const fullPrompt = `<s>[INST] ${systemPrompt}

Question utilisateur: ${query} [/INST]`; // J'ai utilisé "Question utilisateur" pour plus de clarté

      console.log(`[HuggingFaceService] Calling Hugging Face API with model: ${HF_MODEL_NAME}`);
      // console.log(`[HuggingFaceService] Full prompt being sent: \n${fullPrompt}`); // Peut être très long

      const response = await hf.textGeneration({
        model: HF_MODEL_NAME, // Utiliser la variable de configuration
        inputs: fullPrompt,
        parameters: {
          max_new_tokens: 500, // Nombre de nouveaux tokens à générer
          temperature: 0.7,
          top_p: 0.95,
          // top_k: 50, // Optionnel
          do_sample: true, // Nécessaire pour temperature, top_p, top_k
          return_full_text: false, // Pour ne pas avoir le prompt en retour dans generated_text
          // repetition_penalty: 1.1 // Pour éviter la répétition
        }
      });

      if (response && response.generated_text) {
        console.log('[HuggingFaceService] HF raw response:', response.generated_text.trim());
        return response.generated_text.trim();
      } else {
        console.error('[HuggingFaceService] Invalid response structure from Hugging Face:', response);
        throw new Error('Réponse invalide du modèle Hugging Face. Structure de données non attendue.');
      }

    } catch (error) {
      console.error('[HuggingFaceService] Error generating AI response from Hugging Face:', error.message);
      // Vous pourriez vouloir inspecter error.cause ou error.response si disponible
      // if (error.response) console.error('HF API Error details:', error.response.data);
      throw new Error('Échec de la génération de la réponse AI depuis Hugging Face. ' + error.message);
    }
  }
}

module.exports = new HuggingFaceService();