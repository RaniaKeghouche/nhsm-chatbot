// src/services/knowledgeBaseService.js
// Vector search via in-memory cosine similarity (works on any Atlas tier)
// Falls back to keyword search if embeddings are not available

const { MathTip, GeneralFAQ, Resource, Wellness, StudyTip, TeacherInfo, Specialty, StudentExperience, Humor } = require('../models');
const embeddingService = require('./embeddingService');
const config = require('../config/config');

const collectionNameMap = {
  'MathTip': 'Math Tip', 'GeneralFAQ': 'General FAQ', 'Resource': 'Resource',
  'Wellness': 'Wellness Tip', 'StudyTip': 'Study Tip', 'TeacherInfo': 'Teacher Information',
  'Specialty': 'Specialty Information', 'StudentExperience': 'Student Experience', 'Humor': 'Humor Item'
};

const TOP_RESULTS       = 8;    // final context docs for normal queries
const TOP_RESULTS_LIST  = 20;   // for "list all" queries — return more
const MIN_SIM_SCORE     = 0.38; // cosine similarity threshold

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
    // In-memory cache of all docs with embeddings (loaded once on first search)
    this._docCache     = null;
    this._cacheLoading = false;
    console.log(`[KBService] Ready. Collections: ${this.validCollections.length}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // PUBLIC: Main entry point
  // ══════════════════════════════════════════════════════════════════════
  async findRelevantInfoWithKeywords(keywords = [], rawQuery = '') {
    if (keywords.length === 0) return [];
    console.time('KBService_TotalTime');

    // ── Fast-path: "list all professors" queries ─────────────────────────────
    const combined = (rawQuery + ' ' + keywords.join(' ')).toLowerCase();
    if (ALL_TEACHERS_PATTERNS.some(p => p.test(combined))) {
      console.log('[KBService] Detected "list all teachers" query — fetching all TeacherInfo docs');
      const allTeachers = await this.fetchAllFromCollection('TeacherInfo');
      console.timeEnd('KBService_TotalTime');
      return allTeachers.slice(0, TOP_RESULTS_LIST);
    }

    const queryText = keywords.join(' ');
    let results;

    if (config.cohereApiKey) {
      try {
        results = await this._vectorSearch(queryText, keywords);
        if (results.length > 0) {
          console.log(`[KBService] Vector search: ${results.length} results. Top similarity: ${results[0]._vectorScore?.toFixed(3)}`);
          console.timeEnd('KBService_TotalTime');
          return results;
        }
        console.log('[KBService] Vector search returned 0 results, falling back to keywords');
      } catch (err) {
        console.warn(`[KBService] Vector search failed: ${err.message} — falling back to keywords`);
      }
    }

    results = await this._keywordSearch(keywords);
    console.log(`[KBService] Keyword search: ${results.length} results`);
    console.timeEnd('KBService_TotalTime');
    return results;
  }

  async findRelevantInfo(query) {
    const keywords = this.extractKeywords(query.toLowerCase());
    return this.findRelevantInfoWithKeywords(keywords);
  }

  // ══════════════════════════════════════════════════════════════════════
  // VECTOR SEARCH — in-memory cosine similarity
  // Loads all docs with embeddings once, caches them, then scores
  // ══════════════════════════════════════════════════════════════════════
  async _vectorSearch(queryText, keywords = []) {
    const queryVector = await embeddingService.embedText(queryText, 'search_query');

    // Load & cache all embedded docs on first call
    const allDocs = await this._getDocCache();

    if (allDocs.length === 0) {
      throw new Error('No embedded documents found — run generate-embeddings.js first');
    }

    // Build a set of proper-noun keywords (capitalized, length > 3)
    // Used to boost docs where these names appear explicitly
    const nameKeywords = keywords
      .filter(k => k.length > 3 && /[A-Z]/.test(k[0]))
      .map(k => k.toLowerCase());

    // Compute cosine similarity + optional name boost
    const scored = allDocs
      .map(doc => {
        let sim = cosineSimilarity(queryVector, doc.embedding);
        // Name boost: if a proper noun keyword appears in the doc's question or name, +0.08
        if (nameKeywords.length > 0) {
          const docText = ((doc.question || '') + ' ' + (doc.name || '')).toLowerCase();
          const hasName = nameKeywords.some(n => docText.includes(n));
          if (hasName) sim = Math.min(1, sim + 0.08);
        }
        return { ...doc, _vectorScore: sim };
      })
      .filter(doc => doc._vectorScore >= MIN_SIM_SCORE)
      .sort((a, b) => b._vectorScore - a._vectorScore);

    return this.deduplicateAndNormalizeResults(scored).slice(0, TOP_RESULTS);
  }

  // Load all docs from all collections that have embeddings
  async _getDocCache() {
    if (this._docCache) return this._docCache;

    console.log('[KBService] Loading all embedded docs into memory cache...');
    const start = Date.now();

    const promises = this.validCollections.map(async col => {
      try {
        const docs = await col.model.find({ embedding: { $exists: true, $ne: null } }).lean();
        return docs.map(d => ({ ...d, _collectionName: col.name }));
      } catch {
        return [];
      }
    });

    const allDocs = (await Promise.all(promises)).flat();
    this._docCache = allDocs;
    console.log(`[KBService] Cache loaded: ${allDocs.length} embedded docs in ${Date.now() - start}ms`);
    return allDocs;
  }

  // Invalidate cache (call when new docs are added)
  invalidateCache() { this._docCache = null; }

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