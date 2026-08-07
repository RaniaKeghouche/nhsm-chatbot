// src/services/knowledgeBaseService.js
// RECHERCHE HYBRIDE : vecteur (sémantique) + mots-clés (lexical),
// fusionnés par Reciprocal Rank Fusion (RRF), puis re-classés par
// Cohere Rerank (cross-encoder). Fallback gracieux à chaque étage.

const { MathTip, GeneralFAQ, Resource, Wellness, StudyTip, TeacherInfo, Specialty, StudentExperience, Humor } = require('../models');
const embeddingService = require('./embeddingService');
const rerankService = require('./rerankService');
const config = require('../config/config');

const collectionNameMap = {
  'MathTip': 'Math Tip', 'GeneralFAQ': 'General FAQ', 'Resource': 'Resource',
  'Wellness': 'Wellness Tip', 'StudyTip': 'Study Tip', 'TeacherInfo': 'Teacher Information',
  'Specialty': 'Specialty Information', 'StudentExperience': 'Student Experience', 'Humor': 'Humor Item'
};

const TOP_RESULTS       = 8;    // final context docs for normal queries
const TOP_RESULTS_LIST  = 20;   // for "list all" queries — return more
const VECTOR_POOL       = 15;   // candidats gardés par la recherche vectorielle
const KEYWORD_POOL      = 15;   // candidats gardés par la recherche mots-clés
const RERANK_POOL       = 15;   // candidats envoyés au reranker
const MIN_SIM_FLOOR     = 0.30; // plancher absolu de similarité cosinus
const REL_SIM_DELTA     = 0.14; // seuil RELATIF : on garde ce qui est proche du meilleur
const RRF_K             = 60;   // constante standard de Reciprocal Rank Fusion
const CACHE_TTL_MS      = 10 * 60 * 1000; // rechargement auto du cache toutes les 10 min

// En dessous de ce score, le reranker n'a AUCUN signal exploitable : ses
// résultats ne sont plus que du bruit et on garde l'ordre RRF, qui combine
// au moins des preuves lexicales ET sémantiques.
// Observé en conditions réelles : une question en derdja donnait un top score
// de 0.024 et le reranker remontait une fiche professeur pour une question
// portant sur les spécialités.
const RERANK_MIN_CONFIDENCE = 0.05;

// Patterns that mean "give me ALL professors/teachers"
const ALL_TEACHERS_PATTERNS = [
  /list.*prof/i, /tous.*prof/i, /all.*prof/i, /all.*teach/i,
  /liste.*prof/i, /liste.*enseignant/i, /qui sont les prof/i,
  /who are the.*prof/i, /who are the.*teach/i,
  /nombre.*prof/i, /combien.*prof/i, /how many.*prof/i,
  /كل.*أستاذ/i, /قائمة.*أستاذ/i, /ليست.*أستاذ/i,
  /all teachers/i, /list of teachers/i, /list of professors/i,
];

class KnowledgeBaseService {
  constructor() {
    console.log('[KBService] Initializing...');
    this.collectionSearchConfig = [
      { model: MathTip,          name: 'MathTip',          fields: ['question', 'answer', 'tags'] },
      { model: GeneralFAQ,       name: 'GeneralFAQ',       fields: ['question', 'answer', 'tags'] },
      { model: Resource,         name: 'Resource',         fields: ['question', 'answer', 'tags'] },
      { model: Wellness,         name: 'Wellness',         fields: ['question', 'answer', 'tags'] },
      { model: StudyTip,         name: 'StudyTip',         fields: ['question', 'answer', 'tags'] },
      { model: TeacherInfo,      name: 'TeacherInfo',      fields: ['id', 'name', 'question', 'answer', 'tags'] },
      { model: Specialty,        name: 'Specialty',        fields: ['id', 'question', 'answer', 'tags'] },
      { model: StudentExperience,name: 'StudentExperience',fields: ['question', 'answer', 'tags'] },
      { model: Humor,            name: 'Humor',            fields: ['question', 'answer', 'tags'] },
    ];
    this.validCollections = this.collectionSearchConfig.filter(
      c => c.model && typeof c.model.find === 'function'
    );
    // Cache mémoire des docs embedés (chargé au premier search, rafraîchi par TTL)
    this._docCache      = null;
    this._cacheLoadedAt = 0;
    this._cacheLoading  = null; // promesse partagée pendant le chargement
    console.log(`[KBService] Ready. Collections: ${this.validCollections.length}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PUBLIC: Main entry point
  // ══════════════════════════════════════════════════════════════════════
  async findRelevantInfoWithKeywords(keywords = [], rawQuery = '') {
    if (keywords.length === 0 && !rawQuery.trim()) return [];
    // Chrono manuel plutôt que console.time : avec un label fixe, deux requêtes
    // simultanées déclenchent « Label already exists » et faussent la mesure.
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    // ── Fast-path: "list all professors" queries ─────────────────────────────
    const combined = (rawQuery + ' ' + keywords.join(' ')).toLowerCase();
    if (ALL_TEACHERS_PATTERNS.some(p => p.test(combined))) {
      console.log('[KBService] Detected "list all teachers" query — fetching all TeacherInfo docs');
      const allTeachers = await this.fetchAllFromCollection('TeacherInfo');
      console.log(`[KBService] Total: ${elapsed()}`);
      return allTeachers.slice(0, TOP_RESULTS_LIST);
    }

    // ── #1 : on embed la VRAIE question (le sens complet), pas les mots-clés.
    // Les mots-clés ne servent plus qu'à la recherche lexicale + name-boost.
    const searchText = (rawQuery && rawQuery.trim()) || keywords.join(' ');

    // ── #3 : recherche HYBRIDE — vecteur et mots-clés en parallèle ──────────
    const [vectorResults, keywordResults] = await Promise.all([
      this._safeVectorSearch(searchText),
      this._keywordSearch(keywords),
    ]);

    console.log(`[KBService] Hybrid: ${vectorResults.length} vector + ${keywordResults.length} keyword results`);

    let candidates;
    if (vectorResults.length === 0) {
      // Pas de vecteurs disponibles → comportement historique (mots-clés seuls)
      candidates = keywordResults;
    } else if (keywordResults.length === 0) {
      candidates = vectorResults;
    } else {
      // Fusion RRF : combine les deux classements sans dépendre des échelles de score
      candidates = this._reciprocalRankFusion(vectorResults, keywordResults.slice(0, KEYWORD_POOL));
    }

    if (candidates.length === 0) {
      console.log(`[KBService] Total: ${elapsed()} (aucun candidat)`);
      return [];
    }

    // ── #2 : RERANK — le cross-encoder relit chaque candidat face à la question
    const pool = candidates.slice(0, RERANK_POOL);
    let finalResults = pool;
    if (rerankService.available && pool.length > 1) {
      try {
        const reranked = await rerankService.rerank(searchText, pool, TOP_RESULTS);
        const topScore = reranked[0]?._rerankScore ?? 0;

        // Garde-fou : on ne remplace l'ordre RRF que si le reranker est
        // réellement confiant. Sinon son classement est du bruit.
        if (topScore >= RERANK_MIN_CONFIDENCE) {
          finalResults = reranked;
          console.log(`[KBService] Rerank OK: top score ${topScore.toFixed(3)}`);
        } else {
          console.log(`[KBService] Rerank low confidence (${topScore.toFixed(3)} < ${RERANK_MIN_CONFIDENCE}) — keeping RRF order`);
        }
      } catch (err) {
        console.warn(`[KBService] Rerank failed (${err.message}) — keeping RRF order`);
      }
    }

    console.log(`[KBService] Total: ${elapsed()}`);
    return finalResults.slice(0, TOP_RESULTS);
  }

  async findRelevantInfo(query) {
    const keywords = this.extractKeywords(query.toLowerCase());
    return this.findRelevantInfoWithKeywords(keywords, query);
  }

  // Recherche vectorielle qui n'explose jamais (fallback silencieux)
  async _safeVectorSearch(searchText) {
    if (!config.cohereApiKey) return [];
    try {
      return await this._vectorSearch(searchText);
    } catch (err) {
      console.warn(`[KBService] Vector search failed: ${err.message}`);
      return [];
    }
  }

  // ── Reciprocal Rank Fusion ────────────────────────────────────────────────
  // Chaque liste vote pour ses documents selon leur RANG (pas leur score) :
  // score_RRF(doc) = Σ 1/(K + rang). Un doc bien classé dans LES DEUX listes
  // remonte naturellement en tête.
  _reciprocalRankFusion(listA, listB) {
    const scores = new Map(); // id → { doc, score }

    const addVotes = (list) => {
      list.forEach((doc, rank) => {
        const key = doc.id;
        const vote = 1 / (RRF_K + rank + 1);
        if (scores.has(key)) {
          scores.get(key).score += vote;
        } else {
          scores.set(key, { doc, score: vote });
        }
      });
    };

    addVotes(listA);
    addVotes(listB);

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(entry => ({ ...entry.doc, _rrfScore: entry.score }));
  }

  // ══════════════════════════════════════════════════════════════════════
  // VECTOR SEARCH — in-memory cosine similarity
  // #1 : reçoit la question COMPLÈTE (le modèle d'embedding comprend les
  //      phrases, pas les sacs de mots-clés)
  // #4 : score = MAX de similarité entre la question et l'embedding principal
  //      + tous les embeddings de paraphrases du doc (multi-query indexing)
  // ══════════════════════════════════════════════════════════════════════
  // `keywords` n'est plus utilisé ici : le boost de noms propres repart
  // désormais du texte brut de la question, seul endroit où la casse survit.
  async _vectorSearch(queryText) {
    const queryVector = await embeddingService.embedText(queryText, 'search_query');

    // Load & cache all embedded docs on first call
    const allDocs = await this._getDocCache();

    if (allDocs.length === 0) {
      throw new Error('No embedded documents found — run generate-embeddings.js first');
    }

    // Noms propres cherchés dans la question.
    // ⚠️ Bug historique : on filtrait `keywords` sur une majuscule initiale,
    // or aiService.rewriteQueryForSearch() renvoie TOUT en minuscules
    // (`return keywords.toLowerCase()`), donc la liste était TOUJOURS vide et
    // le boost ne s'appliquait jamais. On repart du texte brut de la question,
    // qui lui a conservé sa casse.
    const nameKeywords = (queryText.match(/\b[A-ZÀ-Ý][\wÀ-ÿ'-]{3,}/g) || [])
      .map(w => w.toLowerCase());
    const queryLower = queryText.toLowerCase();

    // Compute max-similarity (doc principal + paraphrases) + name boost
    const scored = allDocs
      .map(doc => {
        let sim = cosineSimilarity(queryVector, doc.embedding);

        // #4 — si le doc a des paraphrases embedées, on prend la MEILLEURE
        // correspondance : une même réponse devient trouvable via toutes
        // les façons de poser la question.
        if (Array.isArray(doc.paraphraseEmbeddings)) {
          for (const pv of doc.paraphraseEmbeddings) {
            const pSim = cosineSimilarity(queryVector, pv);
            if (pSim > sim) sim = pSim;
          }
        }

        // Name boost #1 : un nom propre de la question apparaît dans le doc.
        if (nameKeywords.length > 0) {
          const docText = ((doc.question || '') + ' ' + (doc.name || '')).toLowerCase();
          if (nameKeywords.some(n => docText.includes(n))) sim = Math.min(1, sim + 0.08);
        }

        // Name boost #2 : le nom du document (ex. un professeur) apparaît dans
        // la question. Fonctionne quelle que soit la langue — l'arabe et la
        // derdja n'ont pas de majuscules, donc le boost #1 seul les ignorait.
        if (doc.name) {
          const parts = doc.name.toLowerCase().split(/\s+/).filter(p => p.length > 3);
          if (parts.length > 0 && parts.some(p => queryLower.includes(p))) {
            sim = Math.min(1, sim + 0.08);
          }
        }
        return { ...doc, _vectorScore: sim };
      })
      .sort((a, b) => b._vectorScore - a._vectorScore);

    // Seuil RELATIF : au lieu d'un seuil fixe (fragile), on garde les docs
    // proches du meilleur score, avec un plancher absolu anti-bruit.
    const bestSim = scored.length > 0 ? scored[0]._vectorScore : 0;
    const threshold = Math.max(MIN_SIM_FLOOR, bestSim - REL_SIM_DELTA);
    const kept = scored.filter(doc => doc._vectorScore >= threshold);

    return this.deduplicateAndNormalizeResults(kept).slice(0, VECTOR_POOL);
  }

  // Charge tous les docs embedés en mémoire.
  // - TTL : sans lui, un réindexage (embeddings/paraphrases) restait invisible
  //   jusqu'au redémarrage du serveur.
  // - Promesse partagée : deux requêtes simultanées au démarrage à froid
  //   lançaient chacune un chargement complet de la base.
  async _getDocCache() {
    const fresh = this._docCache
      && (Date.now() - this._cacheLoadedAt) < CACHE_TTL_MS;
    if (fresh) return this._docCache;

    if (this._cacheLoading) return this._cacheLoading;

    this._cacheLoading = (async () => {
      console.log('[KBService] Loading all embedded docs into memory cache...');
      const start = Date.now();

      const promises = this.validCollections.map(async col => {
        try {
          // Projection : depuis l'ajout des paraphrases, chaque document porte
          // 6 vecteurs de 1024 flottants. Sans exclusion, on transférait aussi
          // le TEXTE des paraphrases et une demi-douzaine de champs jamais lus
          // au moment du scoring — pour ~16 Mo tirés d'Atlas à chaque chargement.
          const docs = await col.model
            .find({ embedding: { $exists: true, $ne: null } })
            .select('-paraphrases -related_tips -source -visibility -created_at -updated_at -difficulty -user_role')
            .lean();
          return docs.map(d => ({ ...d, _collectionName: col.name }));
        } catch (err) {
          console.error(`[KBService] Cache load failed for ${col.name}: ${err.message}`);
          return [];
        }
      });

      const allDocs = (await Promise.all(promises)).flat();

      // Si la base est injoignable, on garde l'ancien cache plutôt que de
      // le remplacer par du vide (sinon la recherche vectorielle meurt).
      if (allDocs.length === 0 && this._docCache?.length > 0) {
        console.warn('[KBService] Reload returned 0 docs — keeping previous cache');
        this._cacheLoading = null;
        return this._docCache;
      }

      const withParaphrases = allDocs.filter(d => Array.isArray(d.paraphraseEmbeddings)).length;
      this._docCache     = allDocs;
      this._cacheLoadedAt = Date.now();
      this._cacheLoading  = null;
      console.log(`[KBService] Cache loaded: ${allDocs.length} embedded docs (${withParaphrases} avec paraphrases) in ${Date.now() - start}ms`);
      return allDocs;
    })();

    return this._cacheLoading;
  }

  // Invalidate cache (call when new docs are added)
  invalidateCache() { this._docCache = null; this._cacheLoadedAt = 0; }

  // Préchargement au démarrage : sinon c'est la PREMIÈRE question posée qui
  // paie le chargement complet des vecteurs. Appelé sans await par server.js
  // pour ne pas retarder l'ouverture du port (Render attend le bind pour
  // considérer le service en ligne).
  warmUp() {
    return this._getDocCache()
      .then(docs => console.log(`[KBService] Warm-up terminé : ${docs.length} docs prêts`))
      .catch(err => console.warn(`[KBService] Warm-up échoué (rechargé à la 1re requête): ${err.message}`));
  }

  // ══════════════════════════════════════════════════════════════════════
  // KEYWORD SEARCH — original fallback
  // ══════════════════════════════════════════════════════════════════════
  async _keywordSearch(keywords) {
    const resultsPromises = this.validCollections.map(c => this.searchAndScore(c, keywords));
    const allScoredResults = (await Promise.all(resultsPromises)).flat();
    allScoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return this.deduplicateAndNormalizeResults(allScoredResults);
  }

  async searchAndScore(config, keywords) {
    try {
      const expanded = keywords.flatMap(kw => {
        const list = [kw], lkw = kw.toLowerCase();
        if (lkw.endsWith('ies')) list.push(kw.slice(0,-3)+'y');
        else if (lkw.endsWith('y')) list.push(kw.slice(0,-1)+'ies');
        if (lkw.endsWith('s') && lkw.length>3) list.push(kw.slice(0,-1));
        else if (lkw.length>3) list.push(kw+'s');
        return list;
      });
      const unique = [...new Set(expanded)];
      const pattern = unique.join('|');
      const query = { $or: config.fields.map(f => ({ [f]: { $regex: pattern, $options: 'i' } })) };
      const candidates = await config.model.find(query).lean();
      return candidates.map(doc => {
        let score = 0;
        const q = (doc.question||'').toLowerCase();
        const a = (doc.answer||'').toLowerCase();
        const t = (doc.tags||[]).join(' ').toLowerCase();
        unique.forEach(kw => {
          if (q.includes(kw)) score += 5;
          if (t.includes(kw)) score += 3;
          if (a.includes(kw)) score += 1;
        });
        return { ...doc, _collectionName: config.name, relevanceScore: score };
      });
    } catch (err) {
      console.error(`[KBService] Error in ${config.name}:`, err.message);
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════════════
  extractKeywords(query) {
    const stop = new Set(['a','about','an','and','are','as','at','be','by','for','from',
      'how','i','in','is','it','of','on','or','that','the','this','to','was','what',
      'when','where','who','will','with','tell','me','school','find','can','show','list']);
    return [...new Set(
      query.replace(/['']/g,'').split(/[^a-z0-9]+/u)
        .filter(w => w.length>2 && !stop.has(w) && !/^\d+$/.test(w))
    )];
  }

  async fetchAllFromCollection(collectionName) {
    const col = this.collectionSearchConfig.find(c => c.name === collectionName);
    if (!col) return [];
    const docs = await col.model.find({}).lean();
    return this.deduplicateAndNormalizeResults(docs.map(d => ({ ...d, _collectionName: col.name })));
  }

  deduplicateAndNormalizeResults(results) {
    const seen = new Map();
    results.forEach(doc => {
      const key = doc.id || (doc._id ? doc._id.toString() : null);
      if (key && !seen.has(key)) {
        seen.set(key, {
          id:              key,
          name:            doc.name || null,
          question:        doc.question || `Info: ${doc.name || key}`,
          answer:          doc.answer   || 'Details available.',
          category:        doc.category || collectionNameMap[doc._collectionName] || 'General',
          tags:            doc.tags     || [],
          _collectionName: doc._collectionName,
          relevanceScore:  doc.relevanceScore || 0,
          _vectorScore:    doc._vectorScore   || 0,
        });
      }
    });
    return Array.from(seen.values());
  }
}

// ── Cosine similarity between two equal-length float arrays ──────────────────
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = new KnowledgeBaseService();