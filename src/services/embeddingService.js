// src/services/embeddingService.js
// Uses Cohere /v1/embed (simpler format, works with trial keys)

const config = require('../config/config');

const EMBED_MODEL    = 'embed-multilingual-v3.0';
const EMBED_DIMS     = 1024;
const BATCH_SIZE     = 20;          // Conservative for trial key (5 req/min)
const RETRY_DELAY_MS = 15000;       // 15s between retries on rate limit
const MAX_RETRIES    = 5;

const embeddingCache = new Map();

class EmbeddingService {
  constructor() {
    if (!config.cohereApiKey) {
      console.warn('[EmbeddingService] COHERE_API_KEY not set — vector search unavailable.');
    }
  }

  // Single text embedding (for query at runtime)
  async embedText(text, inputType = 'search_query') {
    if (!config.cohereApiKey) throw new Error('COHERE_API_KEY missing');
    const key = `${inputType}:${text.substring(0, 120)}`;
    if (embeddingCache.has(key)) return embeddingCache.get(key);
    const vectors = await this._callCohere([text], inputType);
    embeddingCache.set(key, vectors[0]);
    return vectors[0];
  }

  // Batch embedding (for migration — respects trial rate limits)
  async embedBatch(texts, inputType = 'search_document') {
    if (!config.cohereApiKey) throw new Error('COHERE_API_KEY missing');
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const vectors = await this._callCohere(batch, inputType);
      results.push(...vectors);
      if (i + BATCH_SIZE < texts.length) {
        await this._sleep(13000); // ~4.5 req/min — safely under trial limit of 5/min
      }
    }
    return results;
  }

  // Cohere v1 API — returns { embeddings: [[...], [...]] }
  async _callCohere(texts, inputType, attempt = 0) {
    const res = await fetch('https://api.cohere.com/v1/embed', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.cohereApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        texts,
        input_type: inputType,
        truncate: 'END'
      })
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = RETRY_DELAY_MS * (attempt + 1);
      console.log(`[EmbeddingService] Rate limit — waiting ${wait/1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await this._sleep(wait);
      return this._callCohere(texts, inputType, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cohere API ${res.status}: ${body}`);
    }

    const data = await res.json();

    // v1 API returns: { embeddings: [[float, float, ...], ...] }
    if (!data.embeddings || !Array.isArray(data.embeddings)) {
      throw new Error(`Unexpected Cohere response: ${JSON.stringify(data).substring(0, 200)}`);
    }

    // Convert to plain JS arrays (important for MongoDB BSON serialization)
    return data.embeddings.map(v => Array.from(v));
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  get dimensions() { return EMBED_DIMS; }
}

module.exports = new EmbeddingService();
