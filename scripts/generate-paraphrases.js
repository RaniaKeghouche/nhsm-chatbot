/**
 * NHSM — Multi-Query Paraphrase Indexing
 * ═══════════════════════════════════════════════════════════════
 * Pour CHAQUE document de la base de connaissances :
 *   1. Groq (Llama) génère 5 reformulations de la question
 *      (français, anglais, derdja) — les façons RÉELLES dont les
 *      étudiants poseraient cette question.
 *   2. Cohere embed chaque reformulation.
 *   3. On stocke `paraphrases` + `paraphraseEmbeddings` dans le doc.
 *
 * Résultat : au runtime, la recherche vectorielle compare la question
 * de l'utilisateur au MEILLEUR des 6 embeddings (1 principal + 5
 * paraphrases) → une même réponse devient trouvable par toutes les
 * manières de poser la question.
 *
 * Run: node scripts/generate-paraphrases.js
 * Options:
 *   --dry-run   Preview without writing
 *   --force     Re-generate even if paraphrases already exist
 *   --col=NAME  Only one collection (e.g. --col=specialties)
 */

// Beaucoup de FAI ne résolvent pas les enregistrements SRV de mongodb+srv://.
// On force donc un résolveur public par défaut (SKIP_PUBLIC_DNS=1 pour désactiver).
const dns = require('dns');
if (process.env.SKIP_PUBLIC_DNS !== '1') {
  try { dns.setServers(['8.8.8.8', '8.8.4.4']); } catch (e) { console.warn('DNS:', e.message); }
}
const mongoose = require('mongoose');
const Groq     = require('groq-sdk');
const config   = require('../src/config/config');

const RAW_COLLECTIONS = [
  'specialties', 'teacherinfos', 'studytips', 'resources', 'wellnesses',
  'generalfaqs', 'mathtips', 'studentexperiences', 'humors',
];

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE   = args.includes('--force');
const COL_ARG = (args.find(a => a.startsWith('--col=')) || '').split('=')[1] || null;

const PARAPHRASES_PER_DOC = 5;
const EMBED_BATCH_DOCS    = 18;    // 18 docs × 5 paraphrases = 90 textes (< 96 max Cohere)
const INTER_BATCH_MS      = 13000; // ~4.5 req/min — sous la limite trial Cohere (5/min)
const INTER_DOC_MS        = 400;   // pacing Groq : ~2.5 req/s, largement sous la limite
const GROQ_MODEL          = 'llama-3.1-8b-instant';

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m',
  red:'\x1b[31m', yellow:'\x1b[33m', cyan:'\x1b[36m', dim:'\x1b[2m'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const groq = new Groq({ apiKey: config.groqApiKey });

// ── 1. Génération des paraphrases avec Groq ─────────────────────────────────
async function generateParaphrases(doc, attempt = 0) {
  const question = doc.question || doc.name || '';
  const answerPreview = (doc.answer || '').substring(0, 400);

  const prompt = `You are helping index a knowledge base for students of NHSM (National Higher School of Mathematics, Algiers).

Given this knowledge base entry:
QUESTION: ${question}
ANSWER (preview): ${answerPreview}

Generate exactly ${PARAPHRASES_PER_DOC} DIFFERENT ways a real student might ask for this information:
- 2 in French (casual student phrasing, e.g. "c'est quoi...", "parlez-moi de...")
- 2 in English (casual phrasing)
- 1 in Algerian Derdja written in Arabic script (e.g. "وش هي...", "كيفاش...")

Rules:
- Each paraphrase must target the SAME information as the original question.
- Vary the vocabulary: use synonyms, different sentence structures, informal styles.
- Return ONLY a JSON array of ${PARAPHRASES_PER_DOC} strings, nothing else.

Example output: ["c'est quoi la spécialité CCS ?", "parle-moi du parcours cryptographie", "what does the CCS track teach?", "tell me about the security specialty", "وش هو تخصص CCS؟"]`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: GROQ_MODEL,
      temperature: 0.7, // un peu de créativité pour VARIER les formulations
    });

    const raw = completion.choices[0]?.message?.content || '[]';
    // Extraire le tableau JSON même si le modèle ajoute du texte autour
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');

    const parsed = JSON.parse(match[0]);
    const paraphrases = parsed
      .filter(p => typeof p === 'string' && p.trim().length > 5)
      .map(p => p.trim().substring(0, 300))
      .slice(0, PARAPHRASES_PER_DOC);

    if (paraphrases.length === 0) throw new Error('Empty paraphrase list');
    return paraphrases;
  } catch (err) {
    if (attempt < 2) {
      await sleep(3000);
      return generateParaphrases(doc, attempt + 1);
    }
    throw err;
  }
}

// ── 2. Embedding Cohere (batch) ─────────────────────────────────────────────
async function cohereEmbed(texts, attempt = 0) {
  const res = await fetch('https://api.cohere.com/v1/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cohereApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'embed-multilingual-v3.0',
      texts,
      input_type: 'search_document', // les paraphrases sont des "documents" indexés
      truncate: 'END'
    })
  });

  if (res.status === 429 && attempt < 5) {
    const wait = 15000 * (attempt + 1);
    console.log(`  ${C.yellow}⏳ Rate limit — waiting ${wait / 1000}s (retry ${attempt + 1}/5)${C.reset}`);
    await sleep(wait);
    return cohereEmbed(texts, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cohere ${res.status}: ${body.substring(0, 300)}`);
  }

  const data = await res.json();
  if (!data.embeddings || !Array.isArray(data.embeddings)) {
    throw new Error(`Unexpected Cohere response: ${JSON.stringify(data).substring(0, 200)}`);
  }
  return data.embeddings.map(v => Array.from(v));
}

// ── 3. Traiter une collection ───────────────────────────────────────────────
async function processCollection(colName) {
  const col = mongoose.connection.collection(colName);
  const filter = FORCE ? {} : { paraphraseEmbeddings: { $exists: false } };
  const docs = await col.find(filter).toArray();

  if (docs.length === 0) {
    console.log(`  ${C.dim}${colName}: already done ✓${C.reset}`);
    return { colName, total: 0, done: 0, failed: 0 };
  }

  console.log(`\n  ${C.bold}${colName}${C.reset} — ${docs.length} docs to process`);
  const stats = { colName, total: docs.length, done: 0, failed: 0 };

  // Traiter par lots pour grouper les appels d'embedding
  for (let i = 0; i < docs.length; i += EMBED_BATCH_DOCS) {
    const batch = docs.slice(i, i + EMBED_BATCH_DOCS);

    // 3a. Générer les paraphrases (Groq est rapide et généreux en rate limit)
    const batchParaphrases = [];
    for (const doc of batch) {
      try {
        const paraphrases = await generateParaphrases(doc);
        batchParaphrases.push({ doc, paraphrases });
        process.stdout.write(`\r    ${C.dim}Paraphrasing ${batchParaphrases.length}/${batch.length}...${C.reset}   `);
        await sleep(INTER_DOC_MS); // pacing Groq
      } catch (err) {
        stats.failed++;
        console.error(`\n    ${C.red}Paraphrase failed for "${(doc.question || '').substring(0, 40)}": ${err.message}${C.reset}`);
      }
    }
    if (batchParaphrases.length === 0) continue;

    // 3b. Embed toutes les paraphrases du lot en UN SEUL appel Cohere
    const allTexts = batchParaphrases.flatMap(bp => bp.paraphrases);
    try {
      const vectors = await cohereEmbed(allTexts);

      // 3c. Redistribuer les vecteurs à chaque doc et écrire en base
      let cursor = 0;
      const ops = [];
      for (const bp of batchParaphrases) {
        const count = bp.paraphrases.length;
        const docVectors = vectors.slice(cursor, cursor + count);
        cursor += count;
        ops.push({
          updateOne: {
            filter: { _id: bp.doc._id },
            update: { $set: { paraphrases: bp.paraphrases, paraphraseEmbeddings: docVectors } }
          }
        });
      }

      if (!DRY_RUN) await col.bulkWrite(ops);
      stats.done += batchParaphrases.length;

      const totalDone = Math.min(i + EMBED_BATCH_DOCS, docs.length);
      console.log(`\r    ${C.green}${Math.round(totalDone / docs.length * 100)}%${C.reset} ${stats.done}/${docs.length} docs indexed          `);
    } catch (err) {
      stats.failed += batchParaphrases.length;
      console.error(`\n    ${C.red}Embed batch failed: ${err.message}${C.reset}`);
    }

    // Respecter la rate limit Cohere entre les lots
    if (i + EMBED_BATCH_DOCS < docs.length) await sleep(INTER_BATCH_MS);
  }

  return stats;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════╗`);
  console.log(`║  NHSM — Multi-Query Paraphrase Indexing           ║`);
  console.log(`║  ${PARAPHRASES_PER_DOC} paraphrases/doc (FR+EN+Derdja) → embeddings  ║`);
  console.log(`╚═══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Mode: ${DRY_RUN ? C.yellow + 'DRY RUN' + C.reset : C.green + 'LIVE' + C.reset}${FORCE ? ' + FORCE' : ''}`);

  if (!config.groqApiKey)   { console.error(`${C.red}❌ GROQ_API_KEY missing${C.reset}`);   process.exit(1); }
  if (!config.cohereApiKey) { console.error(`${C.red}❌ COHERE_API_KEY missing${C.reset}`); process.exit(1); }

  await mongoose.connect(config.mongoURI);
  console.log(`  ${C.green}✅ MongoDB connected${C.reset}`);

  const collections = COL_ARG
    ? RAW_COLLECTIONS.filter(c => c.toLowerCase().includes(COL_ARG.toLowerCase()))
    : RAW_COLLECTIONS;

  const allStats = [];
  for (const colName of collections) {
    allStats.push(await processCollection(colName));
  }

  await mongoose.disconnect();

  console.log(`\n${C.bold}${C.cyan}═══ SUMMARY ═══${C.reset}`);
  let totalDone = 0, totalFailed = 0;
  allStats.forEach(s => {
    if (s.total === 0) return;
    totalDone += s.done; totalFailed += s.failed;
    console.log(`  ${s.colName.padEnd(22)} ${C.green}${s.done}/${s.total}${C.reset}${s.failed ? ` ${C.red}(${s.failed} failed)${C.reset}` : ''}`);
  });
  console.log(`\n  ${C.bold}Total: ${C.green}${totalDone} docs indexed${C.reset}${totalFailed ? `, ${C.red}${totalFailed} failed${C.reset}` : ''}`);
  console.log(`\n${C.cyan}ℹ️  Redémarrez le serveur (le cache en mémoire sera rechargé avec les paraphrases).${C.reset}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
