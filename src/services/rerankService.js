// src/services/rerankService.js
// Cohere Rerank — cross-encoder qui re-classe les documents candidats
// en comparant DIRECTEMENT la question au texte de chaque document.
// Beaucoup plus précis que la similarité cosinus seule.
// En cas d'échec (rate limit, réseau), le caller garde l'ordre RRF existant.

const config = require('../config/config');

const RERANK_MODEL   = 'rerank-multilingual-v3.0'; // FR / EN / AR supportés
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES    = 2;

class RerankService {
  get available() {
    return Boolean(config.cohereApiKey);
  }

  /**
   * Re-classe `docs` par pertinence vis-à-vis de `query`.
   * @param {string} query   - la question (complète, pas des mots-clés)
   * @param {Array}  docs    - documents candidats (question/answer/tags)
   * @param {number} topN    - nombre max de documents à retourner
   * @returns {Array} docs triés, avec `_rerankScore` attaché
   */
  async rerank(query, docs, topN = 8) {
    if (!this.available) throw new Error('COHERE_API_KEY missing');
    if (!docs || docs.length === 0) return [];
    if (docs.length === 1) return docs;

    // Texte envoyé au reranker : question + réponse (tronqué pour rester léger)
    const documents = docs.map(d =>
      `${d.question || ''}\n${d.answer || ''}\nTags: ${(d.tags || []).join(', ')}`.substring(0, 1500)
    );

    const data = await this._callCohere({
      model: RERANK_MODEL,
      query: query.substring(0, 500),
      documents,
      top_n: Math.min(topN, docs.length),
    });

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error(`Unexpected Cohere rerank response: ${JSON.stringify(data).substring(0, 200)}`);
    }

    // Reconstruire la liste dans l'ordre du reranker, score attaché
    const reranked = data.results.map(r => ({
      ...docs[r.index],
      _rerankScore: r.relevance_score,
    }));

    // Filtre doux : on jette uniquement le bruit évident (score quasi nul
    // ET très loin du meilleur). On ne coupe jamais agressivement.
    const best = reranked.length > 0 ? reranked[0]._rerankScore : 0;
    return reranked.filter(d => d._rerankScore >= Math.min(0.01, best * 0.05));
  }

  async _callCohere(body, attempt = 0) {
    const res = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.cohereApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      console.warn(`[RerankService] Rate limit — retry ${attempt + 1}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return this._callCohere(body, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cohere rerank ${res.status}: ${text.substring(0, 200)}`);
    }

    return res.json();
  }
}

module.exports = new RerankService();
