/**
 * Quick vector search test — verifies the new semantic search works
 * Run: node scripts/test-vector.js
 */
const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');
const kb       = require('c:/Users/kegho/Desktop/web/NHSM/src/services/knowledgeBaseService');

const TESTS = [
  { label: 'Spécialités (FR)',    keywords: ['spécialités', 'nhsm', 'specialties'] },
  { label: 'Derdja: étudier',    keywords: ['success', 'réussite', 'nhsm', 'study'] },
  { label: 'Prof Djemmada',       keywords: ['Djemmada', 'professor', 'nhsm'] },
  { label: 'Sommeil/Sleep',       keywords: ['sleep', 'sommeil', 'fatigue'] },
  { label: 'Paraphrase test',     keywords: ['career', 'job', 'graduation', 'nhsm'] },
];

const C = { green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', reset:'\x1b[0m', dim:'\x1b[2m', bold:'\x1b[1m' };

async function main() {
  await mongoose.connect(config.mongoURI);
  console.log(`\n${C.bold}${C.cyan}Vector Search Test${C.reset}\n`);

  for (const t of TESTS) {
    console.log(`${C.bold}${t.label}${C.reset}`);
    const results = await kb.findRelevantInfoWithKeywords(t.keywords);
    if (results.length === 0) {
      console.log(`  ${C.red}❌ No results${C.reset}`);
    } else {
      results.slice(0, 3).forEach((r, i) => {
        const score = r._vectorScore ? `[sim: ${r._vectorScore.toFixed(3)}]` : `[kw: ${r.relevanceScore}]`;
        const method = r._vectorScore ? `${C.green}VECTOR${C.reset}` : `${C.cyan}KEYWORD${C.reset}`;
        console.log(`  ${method} ${score} ${r.question?.substring(0, 70)}`);
      });
    }
    console.log();
  }

  await mongoose.disconnect();
}

main().catch(console.error);
