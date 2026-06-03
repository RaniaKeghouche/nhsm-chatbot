/**
 * NHSM — Embedding Migration Script (v2)
 * Uses raw MongoDB collection to bypass Mongoose schema filtering.
 *
 * Run: node scripts/generate-embeddings.js
 * Options:
 *   --dry-run   Preview without writing
 *   --force     Re-embed docs that already have embeddings
 *   --col=NAME  Only one collection (e.g. --col=Specialty)
 */

const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');

// We bypass Mongoose models — use raw collection names instead
const RAW_COLLECTIONS = [
  'specialties',
  'teacherinfos',
  'studytips',
  'resources',
  'wellnesses',
  'generalfaqs',
  'mathtips',
  'studentexperiences',
  'humors',
];

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE   = args.includes('--force');
const COL_ARG = (args.find(a => a.startsWith('--col=')) || '').split('=')[1] || null;

const BATCH_SIZE     = 20;
const RETRY_MS       = 15000;
const MAX_RETRIES    = 5;
const INTER_BATCH_MS = 13000; // ~4.5 req/min — safely under Cohere trial (5/min)

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m',
  red:'\x1b[31m', yellow:'\x1b[33m', cyan:'\x1b[36m', dim:'\x1b[2m'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Cohere v1 embed call ────────────────────────────────────────────────────
async function cohereEmbed(texts, inputType = 'search_document', attempt = 0) {
  const res = await fetch('https://api.cohere.com/v1/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cohereApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'embed-multilingual-v3.0',
      texts,
      input_type: inputType,
      truncate: 'END'
    })
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = RETRY_MS * (attempt + 1);
    console.log(`  ${C.yellow}⏳ Rate limit — waiting ${wait/1000}s (retry ${attempt+1}/${MAX_RETRIES})${C.reset}`);
    await sleep(wait);
    return cohereEmbed(texts, inputType, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cohere ${res.status}: ${body.substring(0, 300)}`);
  }

  const data = await res.json();
  if (!data.embeddings || !Array.isArray(data.embeddings)) {
    throw new Error(`Unexpected Cohere response: ${JSON.stringify(data).substring(0, 200)}`);
  }

  // Convert to plain JS number arrays (required for MongoDB BSON)
  return data.embeddings.map(v => Array.from(v));
}

// ── Build text to embed from a raw MongoDB doc ──────────────────────────────
function docToText(doc) {
  return [
    doc.question || '',
    doc.answer   || '',
    (doc.tags    || []).join(' '),
    doc.name     || ''
  ].filter(Boolean).join(' ').substring(0, 2000);
}

// ── Process one raw MongoDB collection ─────────────────────────────────────
async function processCollection(colName) {
  const col = mongoose.connection.collection(colName);

  // Count docs needing embedding
  const filter = FORCE ? {} : { embedding: { $exists: false } };
  const total  = await col.countDocuments(filter);

  if (total === 0) {
    console.log(`  ${C.dim}${colName}: already fully embedded ✓${C.reset}`);
    return { colName, total: 0, embedded: 0, failed: 0 };
  }

  console.log(`\n  ${C.bold}${colName}${C.reset} — ${total} docs to embed`);

  const docs = await col.find(filter).toArray();
  const stats = { colName, total: docs.length, embedded: 0, failed: 0 };

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const texts = batch.map(docToText);

    try {
      const vectors = await cohereEmbed(texts, 'search_document');

      if (!DRY_RUN) {
        // Use raw MongoDB bulkWrite — bypasses Mongoose schema
        const ops = batch.map((doc, idx) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { embedding: vectors[idx] } }
          }
        }));
        await col.bulkWrite(ops);
      }

      stats.embedded += batch.length;
      const done = Math.min(i + BATCH_SIZE, docs.length);
      const pct  = Math.round(done / docs.length * 100);
      process.stdout.write(`\r    ${C.green}${pct}%${C.reset} ${done}/${docs.length} embedded`);

      // Pause between batches to respect rate limits
      if (i + BATCH_SIZE < docs.length) await sleep(INTER_BATCH_MS);

    } catch (err) {
      stats.failed += batch.length;
      console.error(`\n    ${C.red}Batch ${i}-${i+BATCH_SIZE} failed: ${err.message}${C.reset}`);
    }
  }

  process.stdout.write('\n');
  return stats;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════╗`);
  console.log(`║  NHSM — Embedding Migration (v2)                  ║`);
  console.log(`║  Model: embed-multilingual-v3.0 (Cohere, 1024d)  ║`);
  console.log(`╚═══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Mode    : ${DRY_RUN ? C.yellow+'DRY RUN'+C.reset : C.green+'LIVE'+C.reset}`);
  console.log(`  Batch   : ${BATCH_SIZE} docs | Delay: ${INTER_BATCH_MS/1000}s`);
  if (COL_ARG) console.log(`  Filter  : "${COL_ARG}" only`);

  if (!config.cohereApiKey) {
    console.error(`\n${C.red}❌ COHERE_API_KEY not set in .env!${C.reset}`);
    process.exit(1);
  }

  // Quick API test before starting
  console.log('\n  Testing Cohere API...');
  try {
    const test = await cohereEmbed(['NHSM test'], 'search_document');
    console.log(`  ${C.green}✅ Cohere OK — got ${test[0].length}d vector${C.reset}`);
  } catch (err) {
    console.error(`  ${C.red}❌ Cohere test failed: ${err.message}${C.reset}`);
    process.exit(1);
  }

  await mongoose.connect(config.mongoURI);
  console.log(`  ${C.green}✅ MongoDB connected${C.reset}\n`);

  const collections = COL_ARG
    ? RAW_COLLECTIONS.filter(c => c.toLowerCase().includes(COL_ARG.toLowerCase()))
    : RAW_COLLECTIONS;

  const allStats = [];
  for (const colName of collections) {
    const stats = await processCollection(colName);
    allStats.push(stats);
  }

  await mongoose.disconnect();

  // Summary
  const total    = allStats.reduce((a, s) => a + s.total, 0);
  const embedded = allStats.reduce((a, s) => a + s.embedded, 0);
  const failed   = allStats.reduce((a, s) => a + s.failed, 0);

  console.log(`\n${C.bold}${C.cyan}═══ SUMMARY ═══${C.reset}`);
  allStats.forEach(s => {
    if (s.total === 0) return;
    const c = s.failed > 0 ? C.red : C.green;
    console.log(`  ${s.colName.padEnd(22)} ${c}${s.embedded}/${s.total}${C.reset}${s.failed ? ` (${s.failed} failed)` : ''}`);
  });

  console.log(`\n  ${C.bold}Total: ${C.green}${embedded} embedded${C.reset}${failed > 0 ? `, ${C.red}${failed} failed${C.reset}` : ''}`);

  if (embedded > 0 && !DRY_RUN) {
    console.log(`\n${C.green}✅ Done! Embeddings saved to MongoDB.${C.reset}`);
    console.log(`\n${C.cyan}Next step:${C.reset} Create Vector Search indexes in Atlas UI.`);
    console.log(`  JSON config: scripts/atlas-index.json\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
