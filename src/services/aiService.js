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
    console.log(`[AIService] Making Groq request: model=${model}, temperature=${temperature}, stream=${stream}, promptLength=${prompt.length}`);
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: model,
      temperature: temperature,
      stream: stream
    });

    if (stream) {
      console.log(`[AIService] Groq stream created successfully`);
      return chatCompletion;
    }

    const content = chatCompletion.choices[0]?.message?.content || '';
    console.log(`[AIService] Groq response received: ${content.substring(0, 100)}...`);
    return content;
  } catch (error) {
    console.error(`[AIService] Groq API call failed for model ${model}:`, error.message);
    // 429 = quota Groq (6000 tokens/min en offre gratuite), pas un bug.
    // On le marque pour que l'appelant affiche un message compréhensible
    // plutôt qu'un « erreur technique » opaque.
    if (error?.status === 429) error.isRateLimit = true;
    throw error;
  }
}

// Message d'attente, dans la langue de l'étudiant
function rateLimitMessage(lang = '') {
  const l = lang.toLowerCase();
  if (l.includes('arabic') || l.includes('derdja')) {
    return 'المساعد مشغول حاليًا 😅 انتظر بضع ثوانٍ ثم أعد المحاولة من فضلك.';
  }
  if (l.includes('english')) {
    return "I'm getting a lot of questions right now 😅 Please wait a few seconds and try again.";
  }
  return "Je reçois beaucoup de questions en ce moment 😅 Patiente quelques secondes et réessaie.";
}

class AIService {
  /**
   * #5 — CONDENSATION CONVERSATIONNELLE
   * Transforme une question de suivi ("et pour SESA ?", "il enseigne quoi ?")
   * en question AUTONOME en utilisant l'historique de la conversation.
   * C'est cette question autonome qui sert ensuite à la recherche en base.
   */
  async condenseConversationalQuery(history = [], userQuery) {
    // Pas d'historique → rien à résoudre
    if (!Array.isArray(history) || history.length === 0) return userQuery;

    // Question déjà longue et explicite → probablement autonome, on économise un appel
    if (userQuery.trim().length > 80) return userQuery;

    const historyText = history
      .slice(-6) // les 6 derniers messages suffisent
      .map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${String(m.content || '').substring(0, 300)}`)
      .join('\n');

    const prompt = `Given a conversation between a student and an assistant of NHSM (National Higher School of Mathematics), rewrite the student's LAST message as a fully standalone question.

Rules:
1. Resolve pronouns and implicit references ("il", "elle", "ça", "cette spécialité", "and him?", "et l'autre ?") using the conversation.
2. Keep the SAME language as the student's last message (French stays French, English stays English, Arabic/Derdja stays Arabic).
3. If the last message is ALREADY standalone, return it unchanged.
4. Return ONLY the rewritten question, no explanation, no quotes.

Conversation:
${historyText}

Student's last message: "${userQuery}"

Standalone question:`;

    try {
      const standalone = await makeGroqRequest(prompt, REWRITE_MODEL, 0.0);
      const cleaned = standalone.trim().replace(/^["']|["']$/g, '');
      // Garde-fous : si le modèle divague, on garde la question originale
      if (!cleaned || cleaned.length < 3 || cleaned.length > 400) return userQuery;
      console.log(`[AIService] Condensed query: "${userQuery}" -> "${cleaned}"`);
      return cleaned;
    } catch (error) {
      console.error('[AIService] Condense failed, using original query.', error.message);
      return userQuery;
    }
  }

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

  _buildSystemRules(detectedLang) {
    const isFrench = detectedLang.toLowerCase().includes('french');
    const isArabic = detectedLang.toLowerCase().includes('arabic') || detectedLang.toLowerCase().includes('derdja');

    if (isArabic) {
      return `أنت مساعد ذكي متخصص في الإجابة عن أسئلة طلاب المدرسة الوطنية العليا للرياضيات (NHSM).
المبادئ التوجيهية:
1. أجب بشكل واضح ومختصر وودود
2. استخدم المعلومات المقدمة فقط
3. إذا كانت المعلومات غير متوفرة، قل ذلك بصراحة
4. تجنب الرد على أسئلة غير المتعلقة بـ NHSM
5. أجب باللغة العربية`;
    }

    if (isFrench) {
      return `Tu es un assistant intelligent spécialisé pour répondre aux questions des étudiants de l'Ecole Nationale Supérieure de Mathématiques (NHSM).
Directives:
1. Réponds de manière claire, concise et amicale
2. Utilise uniquement les informations fournies
3. Si les informations ne sont pas disponibles, dis-le franchement
4. Évite de répondre à des questions non liées à l'NHSM
5. Réponds en français`;
    }

    return `You are an intelligent assistant specialized in answering questions from students of the National School of Advanced Mathematics (NHSM).
Guidelines:
1. Answer clearly, concisely, and in a friendly manner
2. Use only the information provided
3. If information is not available, say so frankly
4. Avoid answering questions unrelated to NHSM
5. Respond in English`;
  }

  _buildPrompt(systemRules, userQuery, context = [], detectedLang, history = []) {
    // Budget de contexte.
    // Le palier gratuit de Groq plafonne à 6000 tokens/minute. Sans borne, une
    // question du type « liste tous les professeurs » produisait un prompt de
    // ~18 600 caractères (~4 600 tokens) : une seule question épuisait presque
    // tout le quota de la minute et les suivantes tombaient en 429.
    // On borne donc chaque source ET le total, en gardant les documents les
    // mieux classés — ils arrivent déjà triés par pertinence.
    const MAX_CONTEXT_CHARS = 7000;
    const MAX_ANSWER_CHARS  = 900;
    const MIN_ANSWER_CHARS  = 260;

    // La part allouée à chaque source s'adapte à leur nombre : on préfère
    // RACCOURCIR toutes les sources plutôt qu'en SUPPRIMER.
    // Sur « liste tous les professeurs », un plafond fixe faisait tomber 7 des
    // 15 fiches et le bot en oubliait la moitié ; ici les 15 passent, résumées.
    const perDoc = context.length > 0
      ? Math.max(MIN_ANSWER_CHARS, Math.min(MAX_ANSWER_CHARS, Math.floor(MAX_CONTEXT_CHARS / context.length)))
      : MAX_ANSWER_CHARS;

    let used = 0;
    const blocks = [];
    for (const doc of context) {
      const question = doc.question || 'Information';
      let answer = doc.answer || 'No details available';
      if (answer.length > perDoc) answer = answer.substring(0, perDoc) + '…';

      const block = `[Source ${blocks.length + 1}]\nQ: ${question}\nA: ${answer}`;
      used += block.length;
      blocks.push(block);
    }

    console.log(`[AIService] Contexte: ${blocks.length} sources, ${used} chars (${perDoc}/source)`);

    const contextText = blocks.join('\n\n');

    const isFrench = detectedLang.toLowerCase().includes('french');
    const isArabic = detectedLang.toLowerCase().includes('arabic') || detectedLang.toLowerCase().includes('derdja');

    let instruction = 'Answer the user\'s question based on the context provided above.';
    if (isFrench) {
      instruction = 'Répondez à la question de l\'utilisateur en vous basant sur le contexte fourni ci-dessus.';
    } else if (isArabic) {
      instruction = 'أجب على سؤال المستخدم بناءً على السياق المقدم أعلاه.';
    }

    // Garde-fou anti-hallucination : sans contexte récupéré, le modèle
    // n'a plus que ses propres connaissances — et il inventerait des
    // professeurs, des modules ou des dates. On lui interdit explicitement
    // de combler le vide, au lieu de compter sur la règle générale.
    if (context.length === 0) {
      if (isArabic) {
        instruction = 'لم يتم العثور على أي معلومة في قاعدة البيانات. أخبر الطالب بصراحة أنك لا تملك هذه المعلومة، واقترح عليه مواضيع يمكنك المساعدة فيها (التخصصات، الأساتذة، طرق الدراسة، الحياة الطلابية). لا تخترع أي معلومة.';
      } else if (isFrench) {
        instruction = "Aucune information n'a été trouvée dans la base de connaissances. Dis franchement à l'étudiant que tu n'as pas cette information, puis propose les sujets que tu peux traiter (spécialités, professeurs, méthodes d'étude, vie étudiante). N'INVENTE AUCUN fait, nom, date ou chiffre.";
      } else {
        instruction = 'No information was found in the knowledge base. Tell the student frankly that you do not have this information, then suggest topics you can help with (specialties, professors, study methods, student life). Do NOT invent any fact, name, date or figure.';
      }
    }

    // #5 — Historique de conversation : permet des réponses cohérentes
    // avec ce qui a déjà été dit ("comme mentionné", pas de répétitions...)
    let historySection = '';
    if (Array.isArray(history) && history.length > 0) {
      const historyText = history
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'STUDENT' : 'ASSISTANT'}: ${String(m.content || '').substring(0, 300)}`)
        .join('\n');
      historySection = `\nCONVERSATION SO FAR:\n${historyText}\n`;
    }

    return `${systemRules}

CONTEXT INFORMATION:
${contextText || '(No relevant information found)'}
${historySection}
${instruction}

USER QUESTION: ${userQuery}

RESPONSE:`;
  }

  // Message de quota atteint, dans la langue de la question.
  // Utilisé par le contrôleur quand le streaming échoue APRÈS l'envoi
  // des en-têtes : on ne peut plus renvoyer un code HTTP, seulement du texte.
  rateLimitReply(userQuery) {
    return rateLimitMessage(this._detectQueryLanguage(userQuery || ''));
  }

  async generateResponse(userQuery, context = [], history = []) {
    console.log(`[AIService] Generating final response with Groq for query: "${userQuery}". Context items: ${context.length}`);
    const detectedLang = this._detectQueryLanguage(userQuery);

    const SYSTEM_RULES = this._buildSystemRules(detectedLang);
    const fullPrompt   = this._buildPrompt(SYSTEM_RULES, userQuery, context, detectedLang, history);

    try {
      const answer = await makeGroqRequest(fullPrompt, GENERATE_MODEL, 0.1);
      console.log('[AIService] Groq final response:', answer.substring(0, 150) + '...');
      return answer;
    } catch (error) {
      console.error('[AIService] Failed to generate final response:', error.message);
      if (error.isRateLimit) return rateLimitMessage(detectedLang);
      return "Je suis désolé, une erreur technique s'est produite. Veuillez réessayer.";
    }
  }

  async generateResponseStream(userQuery, context = [], history = []) {
    console.log(`[AIService] Generating streaming response with Groq for query: "${userQuery}". Context items: ${context.length}`);

    try {
      const detectedLang = this._detectQueryLanguage(userQuery);
      console.log(`[AIService] Detected language: ${detectedLang}`);

      const SYSTEM_RULES = this._buildSystemRules(detectedLang);
      console.log(`[AIService] System rules built. Length: ${SYSTEM_RULES.length}`);

      const fullPrompt   = this._buildPrompt(SYSTEM_RULES, userQuery, context, detectedLang, history);
      console.log(`[AIService] Full prompt built. Length: ${fullPrompt.length}`);

      const stream = await makeGroqRequest(fullPrompt, GENERATE_MODEL, 0.1, true);
      return stream;
    } catch (error) {
      console.error(`[AIService] Failed to generate streaming response:`, error.message);
      console.error(`[AIService] Error details:`, error);
      throw error;
    }
  }
}

module.exports = new AIService();