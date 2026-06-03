/**
 * Creates Atlas Vector Search indexes programmatically
 * Run: node scripts/create-vector-indexes.js
 */
const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');

const COLLECTIONS = [
  'specialties', 'teacherinfos', 'studytips', 'resources',
  'wellnesses', 'generalfaqs', 'mathtips', 'studentexperiences', 'humors'
];

const VECTOR_INDEX = {
  name: 'vector_index',
  type: 'vectorSearch',
  definition: {
    fields: [{
      type: 'vector',
      path: 'embedding',
      numDimensions: 1024,
      similarity: 'cosine'
    }]
  }
};

const C = { green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', reset:'\x1b[0m', dim:'\x1b[2m' };

async function main() {
  console.log(`\n${C.cyan}Creating Atlas Vector Search indexes...${C.reset}\n`);
  await mongoose.connect(config.mongoURI);

  for (const colName of COLLECTIONS) {
    try {
      const col = mongoose.connection.collection(colName);

      // Drop existing index if present (ignore error if doesn't exist)
      try { await col.dropSearchIndex('vector_index'); } catch (_) {}

      await col.createSearchIndex(VECTOR_INDEX);
      console.log(`  ${C.green}✅ ${colName}${C.reset} — index created`);
    } catch (err) {
      console.error(`  ${C.red}❌ ${colName}: ${err.message}${C.reset}`);
    }
  }

  await mongoose.disconnect();
  console.log(`\n${C.cyan}Done. Indexes are being built (takes ~2 min in Atlas).${C.reset}\n`);
}

main().catch(console.error);
